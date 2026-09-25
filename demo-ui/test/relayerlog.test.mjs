import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatRelayerLine, parseLogfmt, tailFile } from '../server/relayerlog.mjs';

// Real lines from logs/relayer.log.
const LINES = {
  pipeline: 'time=2026-09-24T15:27:30.329Z level=INFO msg="Creating pipeline" module=bootstrap sourceChainID=41003 sourceClientID=link-41003-936485 destinationChainID=936485 destinationClientID=link-41003-936485',
  recv: 'time=2026-09-24T15:27:48.269Z level=INFO msg="Submitted tx" module=txsubmitter chainID=936485 txHash=0x54887c663565131f4b3046dadb6440f526edb781db1b20061f8a8038e147f1f2 to=0x145DC4DCB4CA25Fc5df528345e702121cc768E3E',
  ack: 'time=2026-09-24T15:28:12.830Z level=INFO msg="Submitted tx" module=txsubmitter chainID=41003 txHash=0x888494733ab8f004516d3ddcfc660733983e625bea2e0c83e96b6f55fe66dbf3 to=0x145DC4DCB4CA25Fc5df528345e702121cc768E3E',
  complete: 'time=2026-09-24T15:28:15.362Z level=INFO msg="Transfer complete" module=bootstrap module=dispatcher sourceChainID=41003 sourceTxHash=0x29b218ebd1221b219b1ab778e2c9042f0b6b5c5c50a5417131c0b4e56d905acb sourceClientID=link-41003-936485 sequence=2 status=COMPLETE_WITH_ACK',
  relay: 'time=2026-09-24T15:44:11.859Z level=INFO msg=Relay handler=relayer sourceChainID=936485 txHash=0x6fe697a127eefac80774ae3710fb3d5e4b152e0e43a408485bb6e41967976bc1',
  noise: 'time=2026-09-24T15:31:37.241Z level=INFO msg=Packets handler=relayer limit=0 cursor=""',
  warn: 'time=2026-09-24T15:31:37.241Z level=WARN msg="rpc retry" chainID=936485 err="context deadline exceeded"',
};
const fwd = { src: '41003', dst: '936485' };

describe('parseLogfmt', () => {
  it('handles quoted and bare values', () => {
    expect(parseLogfmt(LINES.noise)).toMatchObject({ level: 'INFO', msg: 'Packets', cursor: '' });
    expect(parseLogfmt(LINES.warn).err).toBe('context deadline exceeded');
  });
});

describe('formatRelayerLine', () => {
  const text = (l, ctx = fwd) => formatRelayerLine(l, ctx)?.text;
  it('rewords the lines that matter', () => {
    expect(text(LINES.pipeline)).toBe('creating pipeline 41003 → 936485');
    expect(text(LINES.recv)).toBe('submitted recv tx 0x5488…f1f2 on 936485');
    expect(text(LINES.ack)).toBe('submitted ack tx 0x8884…dbf3 on 41003');
    expect(text(LINES.complete)).toBe('transfer complete · seq 2 · ack');
    expect(text(LINES.relay)).toBe('relay requested for 0x6fe6…6bc1');
    expect(text(LINES.warn)).toBe('warn: rpc retry (context deadline exceeded)');
  });
  it('drops the periodic Packets poll', () => {
    expect(formatRelayerLine(LINES.noise, fwd)).toBeNull();
  });
  it('labels recv/ack by direction', () => {
    expect(text(LINES.recv, { src: '936485', dst: '41003' })).toBe('submitted ack tx 0x5488…f1f2 on 936485');
  });
  it('carries the log timestamp', () => {
    expect(formatRelayerLine(LINES.recv, fwd).at).toBe('2026-09-24T15:27:48.269Z');
  });
});

describe('tailFile', () => {
  let stop;
  afterEach(() => stop?.());
  it('yields only lines appended after start, including a line written in two parts', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tail-')), 'r.log');
    fs.writeFileSync(file, 'old line\n');
    const got = [];
    stop = tailFile(file, (l) => got.push(l), 20);
    fs.appendFileSync(file, 'first\nsec');
    await new Promise((r) => setTimeout(r, 60));
    fs.appendFileSync(file, 'ond\n');
    await new Promise((r) => setTimeout(r, 60));
    expect(got).toEqual(['first', 'second']);
  });
  it('tolerates a missing file', async () => {
    const got = [];
    stop = tailFile('/nonexistent/relayer.log', (l) => got.push(l), 20);
    await new Promise((r) => setTimeout(r, 50));
    expect(got).toEqual([]);
  });
});
