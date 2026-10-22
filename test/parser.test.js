// Synthetic emails modelled on common BCA notification layouts (no real account data).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBcaEmail } from '../src/parser/index.js';
import { normalizeNumber } from '../src/parser/amount.js';
import { categorize } from '../src/categorize.js';

const emailDate = new Date('2026-10-21T03:20:00Z'); // 10:20 WIB

test('normalizeNumber handles Indonesian and English formats', () => {
  assert.equal(normalizeNumber('50.000,00'), 50000);
  assert.equal(normalizeNumber('1.250.000'), 1250000);
  assert.equal(normalizeNumber('1,250,000.00'), 1250000);
  assert.equal(normalizeNumber('150000.50'), 150000.5);
  assert.equal(normalizeNumber('1.500'), 1500);
  assert.equal(normalizeNumber('12,5'), 12.5);
});

test('myBCA QRIS payment in an HTML table', () => {
  const html = `
    <html><head><style>td{color:red}</style></head><body>
    <h2>Pembayaran QRIS Berhasil</h2>
    <table>
      <tr><td>Tanggal Transaksi</td><td>:</td><td>21 Okt 2026 10:15:30 WIB</td></tr>
      <tr><td>Nama Merchant</td><td>:</td><td>KOPI KENANGAN SENOPATI</td></tr>
      <tr><td>Nominal Transaksi</td><td>:</td><td>Rp 38.000,00</td></tr>
      <tr><td>Status</td><td>:</td><td>Berhasil</td></tr>
    </table>
    <p>Saldo minimal Rp 10.000 harus tersedia.</p>
    </body></html>`;
  const r = parseBcaEmail({ subject: 'Notifikasi Transaksi QRIS', html, date: emailDate });
  assert.equal(r.status, 'parsed');
  assert.equal(r.transaction.amount, 38000);
  assert.equal(r.transaction.currency, 'IDR');
  assert.equal(r.transaction.merchant, 'KOPI KENANGAN SENOPATI');
  assert.equal(r.transaction.channel, 'QRIS');
  assert.equal(r.transaction.direction, 'debit');
  assert.equal(r.transaction.occurredAt.toISOString(), '2026-10-21T03:15:30.000Z');
  assert.equal(categorize(r.transaction), 'Food & Drinks');
});

test('KlikBCA-style plain text transfer journal', () => {
  const text = [
    'Internet Transaction Journal',
    'Transaction Date : 20/10/2026 19:42:11',
    'Transaction Type : Transfer to BCA Account',
    'To Account : 1234567890',
    'Beneficiary Name : BUDI SANTOSO',
    'Amount : IDR 1,250,000.00',
    'Remark : Bayar kos Oktober',
    'Status : Successful',
  ].join('\n');
  const r = parseBcaEmail({ subject: 'Internet Transaction Journal', text, date: emailDate });
  assert.equal(r.status, 'parsed');
  assert.equal(r.transaction.amount, 1250000);
  assert.equal(r.transaction.merchant, 'BUDI SANTOSO');
  assert.equal(r.transaction.description, 'Bayar kos Oktober');
  assert.equal(r.transaction.channel, 'Transfer');
  assert.equal(r.transaction.occurredAt.toISOString(), '2026-10-20T12:42:11.000Z');
  assert.equal(categorize(r.transaction), 'Transfer');
});

test('credit card notification with labels and values on separate lines', () => {
  const html = `
    <div>Transaksi Kartu Kredit BCA</div>
    <div>Merchant</div><div>TOKOPEDIA JAKARTA ID</div>
    <div>Jumlah</div><div>IDR 249.900</div>
    <div>Tanggal</div><div>21-10-2026 08:01</div>`;
  const r = parseBcaEmail({ subject: 'Notifikasi Transaksi Kartu Kredit BCA', html, date: emailDate });
  assert.equal(r.status, 'parsed');
  assert.equal(r.transaction.amount, 249900);
  assert.equal(r.transaction.merchant, 'TOKOPEDIA JAKARTA ID');
  assert.equal(r.transaction.channel, 'Credit Card');
  assert.equal(categorize(r.transaction), 'Shopping');
});

test('sentence-style notification falls back to free-text amount and merchant', () => {
  const text = 'Anda telah melakukan transaksi sebesar Rp150.000 di GRAB*CAR pada 21/10/2026 07:30.';
  const r = parseBcaEmail({ subject: 'Notifikasi Transaksi Kartu Debit BCA', text, date: emailDate });
  assert.equal(r.status, 'parsed');
  assert.equal(r.transaction.amount, 150000);
  assert.equal(r.transaction.merchant, 'GRAB*CAR');
  assert.equal(r.transaction.channel, 'Debit Card');
  assert.equal(categorize(r.transaction), 'Transport');
});

test('incoming transfer is recorded as money in', () => {
  const text = 'Dana Masuk\nNominal : Rp 5.000.000,00\nDari : PT MAJU JAYA';
  const r = parseBcaEmail({ subject: 'Notifikasi Dana Masuk', text, date: emailDate });
  assert.equal(r.status, 'parsed');
  assert.equal(r.transaction.direction, 'credit');
  assert.equal(r.transaction.merchant, 'PT MAJU JAYA');
  assert.equal(categorize(r.transaction), 'Income');
});

test('declined, promo and OTP emails are ignored', () => {
  assert.equal(parseBcaEmail({ subject: 'Transaksi Kartu Kredit Ditolak', text: 'Jumlah : Rp 100.000' }).status, 'ignored');
  assert.equal(parseBcaEmail({ subject: 'Promo Spesial Akhir Tahun', text: 'Cashback hingga Rp 500.000' }).status, 'ignored');
  assert.equal(parseBcaEmail({ subject: 'Kode OTP myBCA', text: 'Kode Anda 123456' }).status, 'ignored');
  assert.equal(
    parseBcaEmail({ subject: 'Bukti Transfer', text: 'Nominal : Rp 75.000\nStatus : Gagal' }).status,
    'ignored',
  );
});

test('email without an amount is left for review', () => {
  const r = parseBcaEmail({ subject: 'Informasi Rekening', text: 'Terima kasih telah menggunakan layanan BCA.' });
  assert.equal(r.status, 'unparsed');
});

// ---- Real BCA layouts (structure copied from actual emails, values made up) ----

const FOOTER = `<p>Please save this email as your transaction reference.<br>
  If you do not recognize this transaction, immediately contact Halo BCA at 1500888.</p>`;

// myBCA "Internet Transaction Journal": one <tr> per field with label, ": " and value cells, newlines in the source.
function myBcaJournal(rows) {
  const tr = rows
    .map(([label, value]) => `<tr>\n  <td width="198" valign="top">${label}</td>\n  <td width="2" valign="top">: </td>\n  <td valign="top">${value}</td>\n</tr>`)
    .join('\n');
  return `<p>Hello TEST USER,<br>\nYou just made a transaction through myBCA.<br>\nHere are the details of your transaction :</p>\n<table>\n${tr}\n</table>\n${FOOTER}`;
}

// Credit card notifications: same table idea, Indonesian labels, "&nbsp;" after the colon.
function cardNotification(intro, rows) {
  const tr = rows.map(([label, value]) => `<tr>\n<td>${label}</td>\n<td>:&nbsp;</td>\n<td><span>${value}</td>\n</tr>`).join('\n');
  return `<p>Yth. Pemegang Kartu Kredit BCA,</p><p>${intro}</p><table>${tr}</table>
    <p>silakan menghubungi Halo BCA melalui aplikasi haloBCA atau telepon di 1500888</p>`;
}

const journalDate = new Date('2026-10-19T10:08:30Z');

test('myBCA QRIS journal: merchant from "Payment to", never the Halo BCA phone number', () => {
  const html = myBcaJournal([
    ['Status', 'Successful'],
    ['Transaction Date', '19 Oct 2026 17:08:24'],
    ['Transaction Type', 'QRIS Payment'],
    ['Payment to', 'WARUNG CONTOH'],
    ['Merchant Location', 'Kota Jakarta , 11850, ID'],
    ['Acquirer', 'DANA'],
    ['Merchant PAN', '9360000000000000001'],
    ['Source of Fund', 'TAHAPAN XPRESI - 1234****56'],
    ['Total Payment', 'IDR 21,000.00'],
    ['Reference No.', '1234567890QRS1234567890'],
  ]);
  const r = parseBcaEmail({ subject: 'Internet Transaction Journal', html, date: journalDate });
  assert.equal(r.status, 'parsed');
  assert.equal(r.transaction.merchant, 'WARUNG CONTOH');
  assert.equal(r.transaction.amount, 21000);
  assert.equal(r.transaction.channel, 'QRIS');
  assert.equal(r.transaction.description, null);
  assert.equal(r.transaction.occurredAt.toISOString(), '2026-10-19T10:08:24.000Z');
  assert.equal(categorize(r.transaction), 'Food & Drinks');
});

test('myBCA virtual account journal: company name as merchant, empty description stays empty', () => {
  const html = myBcaJournal([
    ['Status', 'Successful'],
    ['Transaction Date', '20 Oct 2026 11:02:19'],
    ['Transfer Type', 'Transfer to BCA Virtual Account'],
    ['BCA Virtual Account No.', '1234500000000001'],
    ['Name', '000001'],
    ['Company/Product Name', 'PT CONTOH DIGITAL / BLIBLI.COM'],
    ['Bill Total', 'IDR 19,400.00'],
    ['Total Payment', 'IDR 19,400.00'],
    ['Description', ''],
    ['Reference No.', '1234567890TVA1234567890'],
  ]);
  const r = parseBcaEmail({ subject: 'Internet Transaction Journal', html, date: journalDate });
  assert.equal(r.transaction.merchant, 'PT CONTOH DIGITAL / BLIBLI.COM');
  assert.equal(r.transaction.description, null);
  assert.equal(r.transaction.channel, 'Virtual Account');
  assert.equal(categorize(r.transaction), 'Shopping');
});

test('myBCA transfer journal: beneficiary name, "-" remark ignored', () => {
  const html = myBcaJournal([
    ['Status', 'Successful'],
    ['Transaction Date', '20 Oct 2026 21:54:43'],
    ['Transfer Type', 'Transfer to BCA Account'],
    ['Beneficiary Account', '1234564693'],
    ['Beneficiary Name', 'BUDI CONTOH'],
    ['Transfer Amount', 'IDR 100,000.00'],
    ['Remarks', '-'],
  ]);
  const r = parseBcaEmail({ subject: 'Internet Transaction Journal', html, date: journalDate });
  assert.equal(r.transaction.merchant, 'BUDI CONTOH');
  assert.equal(r.transaction.amount, 100000);
  assert.equal(r.transaction.description, null);
  assert.equal(r.transaction.channel, 'Transfer');
});

test('credit card bill paid from myBCA is excluded from totals (purchases are counted separately)', () => {
  const html = myBcaJournal([
    ['Status', 'Successful'],
    ['Transaction Date', '08 Oct 2026 23:26:53'],
    ['Transaction Type', 'Credit Card & Paylater - BCA'],
    ['Card No. / Customer No.', '000000****07'],
    ['Total Bill', 'IDR 2,071,423.00'],
    ['Total Payment', 'IDR 2,071,423.00'],
    ['Remaining Bill', 'IDR 0.00'],
  ]);
  const r = parseBcaEmail({ subject: 'Internet Transaction Journal', html, date: journalDate });
  assert.equal(r.transaction.amount, 2071423);
  assert.equal(r.transaction.channel, 'Card Bill');
  assert.equal(r.transaction.excludeFromTotals, true);
  assert.equal(categorize(r.transaction), 'Credit Card Bill');
});

test('Flazz top-up has no merchant and is described by its type', () => {
  const html = myBcaJournal([
    ['Status', 'Successful'],
    ['Transaction Date', '03 Oct 2026 11:49:37'],
    ['Transaction Type', 'Flazz Top Up'],
    ['Top Up Amount', 'IDR 50,000.00'],
  ]);
  const r = parseBcaEmail({ subject: 'Internet Transaction Journal', html, date: journalDate });
  assert.equal(r.transaction.merchant, null);
  assert.equal(r.transaction.description, 'Flazz Top Up');
  assert.equal(r.transaction.channel, 'Top Up');
  assert.equal(categorize(r.transaction), 'E-Wallet Top Up');
});

test('cardless cash deposit is money in', () => {
  const html = myBcaJournal([
    ['Status', 'Successful'],
    ['Transaction Date', '15 Sep 2026 14:27:54'],
    ['Transfer Type', 'Cardless - Deposit Cash'],
    ['Beneficiary Name', 'TEST USER'],
    ['Amount', 'IDR 300,000.00'],
  ]);
  const r = parseBcaEmail({ subject: 'Cash Deposit Successful', html, date: new Date('2026-09-15T07:28:00Z') });
  assert.equal(r.transaction.direction, 'credit');
  assert.equal(r.transaction.channel, 'Cash Deposit');
  assert.equal(categorize(r.transaction), 'Cash');
});

test('failed myBCA transaction is ignored', () => {
  const html = myBcaJournal([
    ['Status', 'Failed'],
    ['Transaction Type', 'QRIS Payment'],
    ['Total Payment', 'IDR 10,000.00'],
  ]);
  assert.equal(parseBcaEmail({ subject: 'Internet Transaction Journal', html }).status, 'ignored');
});

test('credit card notification: cleaned merchant, Indonesian amount and date', () => {
  const html = cardNotification('Terima kasih telah bertransaksi menggunakan Kartu Kredit BCA:', [
    ['Nomor Kartu', '455600XXXX0000'],
    ['Merchant / ATM', 'Grab* A-9VQQPCGGXEGNAV'],
    ['Jenis Transaksi', 'E-COMMERCE'],
    ['Pada Tanggal', '20-10-2026 13:57:19 WIB'],
    ['Sejumlah', 'Rp5.000,00'],
  ]);
  const r = parseBcaEmail({ subject: 'Credit Card Transaction Notification', html, date: new Date('2026-10-20T06:57:30Z') });
  assert.equal(r.transaction.merchant, 'Grab');
  assert.equal(r.transaction.amount, 5000);
  assert.equal(r.transaction.channel, 'Credit Card');
  assert.equal(r.transaction.occurredAt.toISOString(), '2026-10-20T06:57:19.000Z');
  assert.equal(categorize(r.transaction), 'Transport');
});

test('credit card reversal is a refund', () => {
  const html = cardNotification('Kami informasikan adanya transaksi reversal/void:', [
    ['Merchant / ATM', 'Grab* A-9UW443XGWA6PAV'],
    ['Pada Tanggal', '06-10-2026 07:48:50 WIB'],
    ['Sejumlah', 'Rp19.200,00'],
  ]);
  const r = parseBcaEmail({ subject: 'Credit Card Reversal/Void Transaction Notification', html, date: new Date('2026-10-06T00:49:00Z') });
  assert.equal(r.transaction.direction, 'credit');
  assert.equal(r.transaction.refund, true);
  assert.equal(categorize(r.transaction), 'Refund');
});

test('Halo BCA chat history is not a transaction', () => {
  assert.equal(parseBcaEmail({ subject: 'Halo BCA Chat History', text: 'Rp 100.000' }).status, 'ignored');
});

test('user rules override built-in categories', () => {
  const tx = { merchant: 'WARUNG BU SRI', direction: 'debit', channel: 'QRIS' };
  assert.equal(categorize(tx), 'Food & Drinks');
  assert.equal(categorize(tx, [{ pattern: 'warung bu sri', category: 'Lunch' }]), 'Lunch');
});
