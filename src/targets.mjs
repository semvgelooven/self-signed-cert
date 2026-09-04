import { createInterface } from 'node:readline';

import * as android from './emulator.mjs';
import * as ios from './simulator.mjs';

export const TARGET_IDS = ['ios', 'android'];

const LABELS = { ios: 'iOS Simulator', android: 'Android emulator' };

export const targetLabel = (id) => LABELS[id] ?? id;

/**
 * What we could actually drive right now.
 *
 * Availability is deliberately about *running* devices, not installed tooling:
 * asking "iOS or Android?" is only worth doing when both would really work, and
 * a booted device is the honest test of that. Detection never throws — a missing
 * Xcode or adb is an absent target, not an error.
 */
export async function detectTargets() {
  const [iosReady, androidReady] = await Promise.all([iosAvailable(), androidAvailable()]);
  return [...(iosReady ? ['ios'] : []), ...(androidReady ? ['android'] : [])];
}

async function iosAvailable() {
  if (process.platform !== 'darwin') return false;
  try {
    return ios.pickDevice() !== undefined;
  } catch {
    return false;
  }
}

async function androidAvailable() {
  try {
    const devices = await android.listDevices();
    return devices.some((d) => d.state === 'device');
  } catch {
    return false;
  }
}

/**
 * Decide which targets this run drives.
 *
 * The rule is to only ask a question that has more than one answer. An explicit
 * flag settles it, one running device settles it, and the prompt is reserved for
 * the genuinely ambiguous case of both being up.
 */
export async function resolveTargets({ requested, interactive = process.stdin.isTTY }) {
  if (requested?.length) return requested;

  const available = await detectTargets();

  if (available.length === 0) {
    throw new Error(
      'Nothing to install into. Boot an iOS Simulator, or start an Android emulator\n' +
        'with: emulator -avd <name> -writable-system',
    );
  }

  if (available.length === 1) return available;

  // Both are up and nobody is watching, so do the thing that covers both rather
  // than guessing which one was meant.
  if (!interactive) {
    console.log('Both an iOS Simulator and an Android emulator are running; doing both.');
    return available;
  }

  return promptForTargets(available);
}

async function promptForTargets(available) {
  const lines = available.map((id, i) => `  ${i + 1}) ${targetLabel(id)}`).join('\n');
  const both = available.length + 1;

  const answer = await ask(
    `\nBoth are running. Where should the certificate go?\n${lines}\n  ${both}) both  (default)\n\n> `,
  );

  const choice = answer.trim().toLowerCase();
  if (choice === '' || choice === String(both) || choice === 'both' || choice === 'b') return available;

  const byIndex = available[Number(choice) - 1];
  if (byIndex) return [byIndex];

  const byName = available.find((id) => id === choice || targetLabel(id).toLowerCase().startsWith(choice));
  if (byName) return [byName];

  throw new Error(`Didn't understand "${answer.trim()}". Pass --ios, --android or --both to skip the question.`);
}

// Resolves with '' if the input closes before an answer arrives, so a terminal
// that reports itself as a TTY but hands us EOF takes the default rather than
// hanging on a promise that can never settle.
function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    // Settle on the answer before closing: rl.close() emits 'close' synchronously,
    // and a resolve from there would otherwise beat the real answer to it.
    rl.on('close', () => resolve(''));
    rl.question(question, (answer) => {
      resolve(answer);
      rl.close();
    });
  });
}
