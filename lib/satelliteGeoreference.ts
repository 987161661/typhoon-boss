export interface PixelCrop {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TimedSatelliteFrame {
  capturedAt: string;
}

export interface GeographicBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

interface LongitudeGridControlPoint {
  longitude: number;
  x: number;
}

interface LatitudeGridControlPoint {
  latitude: number;
  y: number;
}

/**
 * Recover the geographic edges of a spherical-Mercator browse image from its
 * own latitude/longitude grid. Pixel positions are measured at grid-line
 * centres; the returned bounds describe the outer image edges used by a map
 * image source.
 */
export function calibrateMercatorImageBounds(
  imageWidth: number,
  imageHeight: number,
  longitudeGrid: LongitudeGridControlPoint[],
  latitudeGrid: LatitudeGridControlPoint[]
): GeographicBounds {
  if (imageWidth <= 0 || imageHeight <= 0) throw new Error("Satellite image dimensions must be positive.");
  if (longitudeGrid.length < 2 || latitudeGrid.length < 2) {
    throw new Error("At least two longitude and latitude control points are required.");
  }

  const longitudeFit = linearFit(longitudeGrid.map(point => [point.longitude, point.x]));
  const latitudeFit = linearFit(latitudeGrid.map(point => [mercatorY(point.latitude), point.y]));
  const longitudeAtPixel = (x: number) => (x - longitudeFit.intercept) / longitudeFit.slope;
  const latitudeAtPixel = (y: number) => inverseMercatorY((y - latitudeFit.intercept) / latitudeFit.slope);

  return {
    west: longitudeAtPixel(0),
    south: latitudeAtPixel(imageHeight),
    east: longitudeAtPixel(imageWidth),
    north: latitudeAtPixel(0)
  };
}

/** NOAA OSPO Tropical Southeast Asia LALO.GIF control-grid calibration. */
export const HIMAWARI_TEASIA_BOUNDS = calibrateMercatorImageBounds(
  1120,
  640,
  [
    { longitude: 80, x: 142 },
    { longitude: 100, x: 420 },
    { longitude: 120, x: 698 },
    { longitude: 140, x: 976 }
  ],
  [
    { latitude: 0, y: 603 },
    { latitude: 10, y: 463 },
    { latitude: 20, y: 319 },
    { latitude: 30, y: 165 }
  ]
);

/**
 * Locate a latitude in a full-world spherical-Mercator image.
 *
 * The GMGSI browse image spans 360 degrees across its full width and places
 * the equator at half the image height. Its vertical scale is therefore
 * derived from the image width, not from a fixed percentage of image height.
 */
export function mercatorLatitudePixel(latitude: number, imageWidth: number, imageHeight: number) {
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
    throw new Error("Satellite image dimensions must be positive finite numbers.");
  }
  const limitedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const latitudeRadians = limitedLatitude * Math.PI / 180;
  const mercatorOffset = Math.log(Math.tan(Math.PI / 4 + latitudeRadians / 2));
  return imageHeight / 2 - imageWidth * mercatorOffset / (2 * Math.PI);
}

/** Build an exact pixel crop for a latitude-bounded full-world Mercator image. */
export function globalMercatorLatitudeCrop(
  imageWidth: number,
  imageHeight: number,
  north = 60,
  south = -60
): PixelCrop {
  if (north <= south) throw new Error("North latitude must be greater than south latitude.");
  const top = clampPixel(Math.round(mercatorLatitudePixel(north, imageWidth, imageHeight)), imageHeight - 1);
  const bottomExclusive = clampPixel(Math.round(mercatorLatitudePixel(south, imageWidth, imageHeight)), imageHeight);
  if (bottomExclusive <= top) throw new Error("Satellite latitude crop is empty.");
  return { left: 0, top, width: imageWidth, height: bottomExclusive - top };
}

function clampPixel(value: number, maximum: number) {
  return Math.max(0, Math.min(maximum, value));
}

function mercatorY(latitude: number) {
  const limitedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  return Math.asinh(Math.tan(limitedLatitude * Math.PI / 180));
}

function inverseMercatorY(value: number) {
  return Math.atan(Math.sinh(value)) * 180 / Math.PI;
}

function linearFit(points: Array<[number, number]>) {
  const xMean = points.reduce((sum, [x]) => sum + x, 0) / points.length;
  const yMean = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
  const denominator = points.reduce((sum, [x]) => sum + (x - xMean) ** 2, 0);
  if (denominator === 0) throw new Error("Satellite grid control points must span more than one value.");
  const slope = points.reduce((sum, [x, y]) => sum + (x - xMean) * (y - yMean), 0) / denominator;
  return { slope, intercept: yMean - slope * xMean };
}

/**
 * Anchor a multi-product display to the newest available global frame, then
 * select the regional frame nearest that same observation time. This prevents
 * fast-moving clouds from being drawn twice several hours apart.
 */
export function selectSynchronizedSatellitePair<T extends TimedSatelliteFrame>(
  regionalFrames: T[],
  globalFrames: T[],
  nowMs = Date.now() + 5 * 60 * 1000
) {
  if (regionalFrames.length === 0 || globalFrames.length === 0) {
    throw new Error("Both regional and global satellite frame lists are required.");
  }
  const notFuture = (frame: T) => Date.parse(frame.capturedAt) <= nowMs;
  const regional = regionalFrames.filter(notFuture);
  const global = globalFrames.filter(notFuture);
  const globalFrame = newestFrame(global.length ? global : globalFrames);
  const globalTime = Date.parse(globalFrame.capturedAt);
  const regionalFrame = (regional.length ? regional : regionalFrames).reduce((best, frame) => {
    const difference = Math.abs(Date.parse(frame.capturedAt) - globalTime);
    const bestDifference = Math.abs(Date.parse(best.capturedAt) - globalTime);
    if (difference !== bestDifference) return difference < bestDifference ? frame : best;
    return Date.parse(frame.capturedAt) > Date.parse(best.capturedAt) ? frame : best;
  });
  return { regional: regionalFrame, global: globalFrame };
}

function newestFrame<T extends TimedSatelliteFrame>(frames: T[]) {
  return frames.reduce((newest, frame) => Date.parse(frame.capturedAt) > Date.parse(newest.capturedAt) ? frame : newest);
}
