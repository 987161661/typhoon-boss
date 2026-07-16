import type { Feature, FeatureCollection, Point } from "geojson";
import type { NationalWeatherEvent, WeatherEventLevel } from "@/lib/nationalWeatherTypes";

export const NATIONAL_EVENT_SOURCE_ID = "national-weather-events";

export const NATIONAL_EVENT_LAYER_IDS = {
  watch: "national-events-watch",
  ordinary: "national-events-ordinary",
  officialHigh: "national-events-official-high",
  officialHighRing: "national-events-official-high-ring"
} as const;

export type NationalEventCategory = "official-high" | "ordinary" | "watch";

export interface NationalEventFeatureProperties {
  eventId: string;
  level: WeatherEventLevel;
  category: NationalEventCategory;
  priority: number;
}

const LEVEL_PRIORITY: Record<WeatherEventLevel, number> = {
  red: 500,
  orange: 400,
  yellow: 300,
  blue: 200,
  watch: 100
};

export function nationalEventPriority(event: NationalWeatherEvent) {
  const officialBoost = event.evidenceLevel === "official" && (event.level === "red" || event.level === "orange")
    ? 1_000
    : 0;
  return officialBoost + LEVEL_PRIORITY[event.level];
}

export function nationalEventCategory(event: NationalWeatherEvent): NationalEventCategory {
  if (event.level === "watch") return "watch";
  if (event.evidenceLevel === "official" && (event.level === "red" || event.level === "orange")) return "official-high";
  return "ordinary";
}

export function buildNationalEventFeatureCollection(
  events: readonly NationalWeatherEvent[]
): FeatureCollection<Point, NationalEventFeatureProperties> {
  const features: Array<Feature<Point, NationalEventFeatureProperties>> = events
    .filter((event) => event.kind !== "typhoon" && event.geography.centroid !== null)
    .map<Feature<Point, NationalEventFeatureProperties>>((event) => ({
      type: "Feature",
      id: event.id,
      geometry: {
        type: "Point",
        coordinates: [event.geography.centroid!.longitude, event.geography.centroid!.latitude]
      },
      properties: {
        eventId: event.id,
        level: event.level,
        category: nationalEventCategory(event),
        priority: nationalEventPriority(event)
      }
    }))
    .sort((left, right) => left.properties.priority - right.properties.priority || left.properties.eventId.localeCompare(right.properties.eventId));

  return { type: "FeatureCollection", features };
}

export function nationalEventCleanupIds(): string[] {
  const cleanupIds: string[] = [...Object.values(NATIONAL_EVENT_LAYER_IDS)].reverse();
  cleanupIds.push(NATIONAL_EVENT_SOURCE_ID);
  return cleanupIds;
}
