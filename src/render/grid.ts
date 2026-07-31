import { Point } from "./Viewport";

/** Minimum geometry needed to snap a point to a grid. Satisfied by `FogData`. */
export interface SnapGrid {
  cellSize: number;
  originX: number;
  originY: number;
}

/**
 * Snap an image-space point to the grid based on the token radius (creature
 * size). Odd-sized creatures (1×1, 3×3 …) snap to a cell center; even-sized
 * creatures (2×2, 4×4 …) snap to a grid corner/cross so they straddle cells
 * symmetrically. Returns the point unchanged when the grid is degenerate.
 *
 * Shared by the DM view's drag handling and the iPad map server so player and
 * DM token moves snap identically.
 */
export function snapTokenPoint(img: Point, radius: number, grid: SnapGrid): Point {
  const { cellSize, originX, originY } = grid;
  if (cellSize <= 0) return img;

  // Determine creature size in cells (diameter / cellSize, rounded).
  const sizeInCells = Math.max(1, Math.round((radius * 2) / cellSize));

  if (sizeInCells % 2 === 0) {
    // Even (2×2, 4×4 …): center sits on a grid corner.
    return {
      x: Math.round((img.x - originX) / cellSize) * cellSize + originX,
      y: Math.round((img.y - originY) / cellSize) * cellSize + originY,
    };
  }
  // Odd (1×1, 3×3 …): center sits in the middle of a cell.
  return {
    x: (Math.floor((img.x - originX) / cellSize) + 0.5) * cellSize + originX,
    y: (Math.floor((img.y - originY) / cellSize) + 0.5) * cellSize + originY,
  };
}

/** Snap a point to the nearest grid intersection (used for spell origins). */
export function snapToIntersection(img: Point, grid: SnapGrid): Point {
  const { cellSize, originX, originY } = grid;
  if (cellSize <= 0) return img;
  return {
    x: Math.round((img.x - originX) / cellSize) * cellSize + originX,
    y: Math.round((img.y - originY) / cellSize) * cellSize + originY,
  };
}
