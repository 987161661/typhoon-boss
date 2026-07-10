export type CycloneRotationDirection = "counterclockwise" | "clockwise";

export function cycloneTangentialSign(latitude: number): 1 | -1 {
  return latitude < 0 ? -1 : 1;
}

export function cycloneVisualKinematics(latitude: number) {
  const tangentialSign = cycloneTangentialSign(latitude);
  const cssRotationSign = -tangentialSign;
  return {
    direction: (tangentialSign > 0 ? "counterclockwise" : "clockwise") as CycloneRotationDirection,
    textureStartDeg: cssRotationSign * -3,
    textureEndDeg: cssRotationSign * 357,
    rainbandMidDeltaDeg: cssRotationSign * 16,
    rainbandEndDeltaDeg: cssRotationSign * 42,
    textureMirror: tangentialSign > 0 ? 1 : -1
  } as const;
}
