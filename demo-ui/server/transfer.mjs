// One transfer, end to end, as checkpoints. Mirrors scripts/transfer.sh:
// forward is auto-relayed from Besu; return needs `relayer relay` because
// Zenith has no websocket for the relayer to watch.

export const CHAIN = { besu: '41003', zenith: '936485' };
export const CLIENT_ID = 'link-41003-936485';
const WEI = 10n ** 18n;
const AMOUNT = { forward: 10n, return: 10n };

const short = (h) => `${h.slice(0, 6)}…${h.slice(-4)}`;

export const toTokens = (raw) => Number(BigInt(raw) / 10n ** 14n) / 1e4;

const SUCCEEDED = 'PACKET_STATE_SUCCEEDED';
const isTerminal = (state) => state && state !== 'PACKET_STATE_PENDING' && state !== 'PACKET_STATE_UNSPECIFIED';

/** Checkpoints for whatever changed between two polls of `ibc relayer packets`. */
export function packetCheckpoints(prev, pkt) {
  const out = [];
  if (pkt.sequenceNumber && !prev?.sequenceNumber) out.push({ kind: 'sequence', sequence: Number(pkt.sequenceNumber) });
  if (pkt.recvTx?.txHash && !prev?.recvTx?.txHash) out.push({ kind: 'received', txHash: pkt.recvTx.txHash });
  if (pkt.ackTx?.txHash && !prev?.ackTx?.txHash) out.push({ kind: 'acked', txHash: pkt.ackTx.txHash });
  if (isTerminal(pkt.state) && pkt.state !== prev?.state) {
    out.push({ kind: 'complete', status: pkt.state === SUCCEEDED ? 'COMPLETE_WITH_ACK' : pkt.state });
  }
  return out;
}

async function balances(ibcJson) {
  const one = async (chain) => {
    const ift = (await ibcJson(['deploy', 'show', chain])).tokens[0].address;
    const r = await ibcJson(['query', 'ift', 'balance', '--chain', chain, '--ift', ift, '--address', 'deployer']);
    return toTokens(r.balance);
  };
  return { kind: 'balances', besu: await one(CHAIN.besu), zenith: await one(CHAIN.zenith) };
}

export async function runTransfer(direction, {
  ibcJson, ibcRaw, emit,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  pollMs = 2000,
  timeoutMs = 16 * 60 * 1000, // the packet's own timeout is 15 minutes
  relayDelayMs = 8000,
  maxPollFailures = 5,
}) {
  const src = direction === 'forward' ? CHAIN.besu : CHAIN.zenith;
  const note = (text) => emit({ kind: 'log', at: new Date().toISOString(), source: 'ui', text });

  emit({ kind: 'meta', recipient: (await ibcJson(['keys', 'show', 'deployer'])).evmAddress });
  const bal = await balances(ibcJson);
  emit(bal);
  note(`balances · Besu ${bal.besu} · Zenith ${bal.zenith} ZPOC`);

  const ift = (await ibcJson(['deploy', 'show', src])).tokens[0].address;
  note(`$ ibc tx ift send --chain ${src} --amount ${AMOUNT[direction]} ZPOC`);
  const send = await ibcJson(['tx', 'ift', 'send', '--chain', src, '--ift', ift, '--client-id', CLIENT_ID,
    '--to', 'deployer', '--from', 'deployer', '--amount', String(AMOUNT[direction] * WEI)]);
  if (!send.txHash?.startsWith('0x')) throw new Error(`send did not return a tx hash: ${JSON.stringify(send).slice(0, 200)}`);
  emit({ kind: 'sent', txHash: send.txHash });
  note(`send tx ${short(send.txHash)} landed on ${src}`);

  if (direction === 'return') {
    await sleep(relayDelayMs); // let the send land before asking the relayer to read it
    note(`$ ibc relayer relay --chain-id ${src} --tx-hash ${short(send.txHash)}`);
    const out = await ibcRaw(['relayer', 'relay', '--chain-id', src, '--tx-hash', send.txHash]);
    const failure = out.split('\n').find((l) => /^\s*error\b/i.test(l));
    if (failure) throw new Error(`relay request failed: ${failure.trim()}`);
  }

  // The send is on chain now, so a failed poll (e.g. the relayer holding the
  // SQLite lock) is retried rather than ending the take mid-flight.
  let prev = null;
  let failures = 0;
  for (let waited = 0; waited <= timeoutMs; waited += pollMs) {
    let pkt;
    try {
      pkt = (await ibcJson(['relayer', 'packets', '--chain-id', src, '--tx-hash', send.txHash])).packets?.[0];
      failures = 0;
    } catch (err) {
      if (++failures >= maxPollFailures) throw err;
      note(`packet query failed, retrying: ${err.message}`);
    }
    if (pkt) {
      packetCheckpoints(prev, pkt).forEach(emit);
      if (isTerminal(pkt.state)) return;
      prev = pkt;
    }
    await sleep(pollMs);
  }
  throw new Error(`packet did not finish within ${Math.round(timeoutMs / 60000)} min; check \`make logs\``);
}
