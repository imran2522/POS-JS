// Thermal printer connection from the browser (Chrome / Edge).
// WebUSB: USB printers. Web Serial: serial and Bluetooth printers. Needs HTTPS or localhost.
import { getPrinterPrefs, setPrinterPrefs } from './storage.js';

let conn = null;
export const supported = () => ({ usb: 'usb' in navigator, serial: 'serial' in navigator });
export const isConnected = () => !!conn;
export const kind = () => conn?.kind ?? null;

async function openUsb(device) {
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);
  let target = null;
  for (const iface of device.configuration.interfaces) {
    for (const alt of iface.alternates) {
      const ep = alt.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
      if (ep && !target) target = { iface: iface.interfaceNumber, alt: alt.alternateSetting, ep: ep.endpointNumber };
    }
  }
  if (!target) throw new Error('This USB device has no printer output. Is it the receipt printer?');
  await device.claimInterface(target.iface);
  if (target.alt) await device.selectAlternateInterface(target.iface, target.alt);
  return {
    kind: 'usb',
    async send(bytes) { for (let i = 0; i < bytes.length; i += 4096) await device.transferOut(target.ep, bytes.slice(i, i + 4096)); },
    async close() { try { await device.close(); } catch { /* already gone */ } },
  };
}

async function openSerial(port) {
  await port.open({ baudRate: getPrinterPrefs().baud || 9600 });
  return {
    kind: 'serial',
    async send(bytes) {
      const w = port.writable.getWriter();
      try { await w.write(bytes); } finally { w.releaseLock(); }
    },
    async close() { try { await port.close(); } catch { /* already gone */ } },
  };
}

export async function connect(which) {
  await disconnect();
  conn = which === 'usb'
    ? await openUsb(await navigator.usb.requestDevice({ filters: [] }))
    : await openSerial(await navigator.serial.requestPort());
  setPrinterPrefs({ ...getPrinterPrefs(), kind: which });
}

// After a page reload, reuse a printer the user already approved (no prompt).
export async function reconnect() {
  const { kind: saved } = getPrinterPrefs();
  try {
    if (saved === 'usb' && 'usb' in navigator) { const [d] = await navigator.usb.getDevices(); if (d) conn = await openUsb(d); }
    if (saved === 'serial' && 'serial' in navigator) { const [p] = await navigator.serial.getPorts(); if (p) conn = await openSerial(p); }
  } catch { conn = null; }
  return isConnected();
}

export async function disconnect(forget = false) {
  if (conn) await conn.close();
  conn = null;
  if (forget) setPrinterPrefs({ ...getPrinterPrefs(), kind: null });
}

export async function print(bytes) {
  if (!conn) throw new Error('No printer connected');
  await conn.send(bytes);
}
