import { describe, expect, it } from 'vitest';
import { buildJourney, short, waitingLabel } from '../src/journeys';

const FORWARD_IDS = [
  'user_send', 'gmp_to_core', 'commit', 'attest_src', 'relay_recv', 'route_app', 'mint', 'canton',
  'ack_app', 'ack_write', 'attest_ack', 'relay_ack', 'ack_submit', 'ack_verify', 'ack_done', 'outro',
];

describe('buildJourney', () => {
  it('forward has the sketch order with canton after the mint', () => {
    const j = buildJourney('forward');
    expect(j.steps.map((s) => s.id)).toEqual(FORWARD_IDS);
    expect(j).toMatchObject({ src: 'b', dst: 'z', amount: 10 });
    expect(j.steps.find((s) => s.id === 'canton')!.needs).toBe('received');
  });

  it('return mirrors the chains and shows canton right after the burn on Zenith', () => {
    const j = buildJourney('return');
    expect(j.steps).toHaveLength(16);
    expect(j.steps.map((s) => s.id).slice(0, 3)).toEqual(['user_send', 'canton', 'gmp_to_core']);
    expect(j).toMatchObject({ src: 'z', dst: 'b', amount: 2 });
    expect(j.steps[1].needs).toBe('sent');
  });

  it('takes an explicit amount for live runs', () => {
    expect(buildJourney('return', 10).amount).toBe(10);
  });

  it('gates each step on the event that makes it true', () => {
    const needs = Object.fromEntries(buildJourney('forward').steps.map((s) => [s.id, s.needs]));
    expect(needs).toMatchObject({
      user_send: 'sent', commit: 'sent', attest_src: null, relay_recv: 'received',
      mint: 'received', ack_submit: 'acked', ack_done: 'complete', outro: null,
    });
  });
});

describe('waitingLabel', () => {
  it('names the chain being waited on', () => {
    const j = buildJourney('forward');
    expect(waitingLabel(j, 'sent')).toBe('Waiting for the send to land on Besu…');
    expect(waitingLabel(j, 'received')).toBe('Waiting for the relayer to deliver on Canton…');
    expect(waitingLabel(buildJourney('return'), 'acked')).toBe('Waiting for the ack to land on Canton…');
  });
});

describe('short', () => {
  it('abbreviates hashes and tolerates missing values', () => {
    expect(short('0x728727ad87269585daac3b16af4f919dcb17cc36c1f8117d74094a56ea04900e')).toBe('0x7287…900e');
    expect(short(undefined)).toBe('…');
  });
});
