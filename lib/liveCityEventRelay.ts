import { isHostLiveComment, type HostLiveComment } from "./liveCityInteraction";

const MAX_EVENTS = 200;
type LiveCityEventEntry = { sequence: number; event: HostLiveComment };
type LiveCityEventRelayState = {
  sequence: number;
  events: LiveCityEventEntry[];
  eventIds: Set<string>;
};

declare global {
  var typhoonLiveCityEventRelayState: LiveCityEventRelayState | undefined;
}

const relayState = globalThis.typhoonLiveCityEventRelayState ??= {
  sequence: 0,
  events: [],
  eventIds: new Set<string>()
};

export function publishLiveCityEvent(value: unknown) {
  if (!isHostLiveComment(value)) return false;
  if (relayState.eventIds.has(value.id)) return true;
  relayState.eventIds.add(value.id);
  relayState.events.push({ sequence: ++relayState.sequence, event: value });
  while (relayState.events.length > MAX_EVENTS) {
    const removed = relayState.events.shift();
    if (removed) relayState.eventIds.delete(removed.event.id);
  }
  return true;
}

export function readLiveCityEvents(after = 0) {
  return relayState.events.filter((item) => item.sequence > after);
}

export function latestLiveCityEventSequence() {
  return relayState.sequence;
}
