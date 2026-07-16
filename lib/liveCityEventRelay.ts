import { isHostLiveComment, type HostLiveComment } from "./liveCityInteraction";

const MAX_EVENTS = 200;
let sequence = 0;
const events: Array<{ sequence: number; event: HostLiveComment }> = [];

export function publishLiveCityEvent(value: unknown) {
  if (!isHostLiveComment(value)) return false;
  events.push({ sequence: ++sequence, event: value });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  return true;
}

export function readLiveCityEvents(after = 0) {
  return events.filter((item) => item.sequence > after);
}

export function latestLiveCityEventSequence() {
  return sequence;
}
