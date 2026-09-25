// Real values from RESULTS.md and the local keystore. Nothing here is invented;
// only the starting balances are chosen, to read cleanly on camera.

import type { Checkpoint, Direction, Source } from '../types';

const RECIPIENT = '0x4a6b16b0C11084A86F4e06dB1fCA90bcb8009Fc3';

export const SCRIPTED: Record<Direction, Checkpoint[]> = {
  forward: [
    { kind: 'meta', recipient: RECIPIENT },
    { kind: 'balances', besu: 100, zenith: 0 },
    { kind: 'sent', txHash: '0x728727ad87269585daac3b16af4f919dcb17cc36c1f8117d74094a56ea04900e' },
    { kind: 'sequence', sequence: 1 },
    { kind: 'received', txHash: '0xeb0417e13abbfe9549d6de3ed9ceb4caf0432e2666cdbb1bf36d9853a397124c' },
    { kind: 'canton', update: '12206550d1…552d228d' },
    { kind: 'acked', txHash: '0x15bea9bff0d6284a2fb2c2f301fa055baa042680b7ecc948c39200599f199a46' },
    { kind: 'complete', status: 'COMPLETE_WITH_ACK' },
  ],
  return: [
    { kind: 'meta', recipient: RECIPIENT },
    { kind: 'balances', besu: 90, zenith: 10 },
    { kind: 'sent', txHash: '0x6fe697a127eefac80774ae3710fb3d5e4b152e0e43a408485bb6e41967976bc1' },
    { kind: 'sequence', sequence: 3 },
    { kind: 'received', txHash: '0x5e5f10c646742194cfbee7c0a9583e71bcb1bc02a447ae3abf3276002be462ff' },
    { kind: 'acked', txHash: '0x18b2b281891b5390ea4c750b9eecf3ae5cb655701472cfdc9f5d639a0e0a77b5' },
    { kind: 'complete', status: 'COMPLETE_WITH_ACK' },
  ],
};

/** Emits every checkpoint synchronously, so a scripted take never waits. */
export const scriptedSource: Source = {
  async start(direction, emit) {
    SCRIPTED[direction].forEach(emit);
  },
  stop() {},
};
