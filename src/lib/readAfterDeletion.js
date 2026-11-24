// The native delete route commits during request cleanup. A follow-up read may
// reach another worker just before that commit becomes visible.
export async function readAfterDeletion(read, deleted, signal, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  let keys = await read();
  for (const delay of [200, 600, 1200]) {
    if (!deleted || !keys.some(key => key.client_id === deleted)) break;
    await wait(delay);
    signal.throwIfAborted();
    keys = await read();
  }
  return keys;
}
