import type { CameraControls } from "@react-three/drei";
import type { ElementRef } from "react";

export type Controls = ElementRef<typeof CameraControls>;
export const cam: { controls: Controls | null } = { controls: null };
