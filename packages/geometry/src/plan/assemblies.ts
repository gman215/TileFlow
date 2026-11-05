/**
 * Wall assembly presets.
 *
 * Lumber is stored at its actual dressed size, never its nominal one: a 2×4 is
 * 1½″ × 3½″. Getting that wrong is the classic way a plan's clear dimensions
 * end up an inch out across a few partitions.
 */

import { MM_PER_INCH, WallAssembly, WallLayer } from '../types';

const inch = (n: number) => n * MM_PER_INCH;

const layer = (
  material: string,
  thickness: number,
  fn: WallLayer['function']
): WallLayer => ({ material, thickness, function: fn });

const DRYWALL_HALF = layer('Drywall ½″', inch(1 / 2), 'finish');
const CEMENT_BOARD_HALF = layer('Cement board ½″', inch(1 / 2), 'substrate');
const OSB_7_16 = layer('OSB 7⁄16″', inch(7 / 16), 'sheathing');
const PLASTERBOARD = layer('Plasterboard 12.5 mm', 12.5, 'finish');
const CEMENT_BOARD_METRIC = layer('Cement board 12.5 mm', 12.5, 'substrate');

const STUD_2X4 = { studWidth: inch(1.5), studDepth: inch(3.5) };
const STUD_2X6 = { studWidth: inch(1.5), studDepth: inch(5.5) };
const STUD_89 = { studWidth: 38, studDepth: 89 };
const STUD_140 = { studWidth: 38, studDepth: 140 };

export const ASSEMBLY_PRESETS: WallAssembly[] = [
  {
    id: 'interior-2x4',
    name: 'Interior 2×4',
    layers: [DRYWALL_HALF, layer('2×4 stud', STUD_2X4.studDepth, 'core'), DRYWALL_HALF],
    framing: STUD_2X4,
  },
  {
    id: 'interior-2x6',
    name: 'Interior 2×6 (plumbing)',
    layers: [DRYWALL_HALF, layer('2×6 stud', STUD_2X6.studDepth, 'core'), DRYWALL_HALF],
    framing: STUD_2X6,
  },
  {
    id: 'wet-2x4',
    name: 'Wet wall 2×4',
    layers: [CEMENT_BOARD_HALF, layer('2×4 stud', STUD_2X4.studDepth, 'core'), DRYWALL_HALF],
    framing: STUD_2X4,
  },
  {
    id: 'exterior-2x6',
    name: 'Exterior 2×6',
    layers: [DRYWALL_HALF, layer('2×6 stud', STUD_2X6.studDepth, 'core'), OSB_7_16],
    framing: STUD_2X6,
  },
  {
    id: 'interior-89',
    name: 'Interior 89 mm',
    layers: [PLASTERBOARD, layer('89 mm stud', STUD_89.studDepth, 'core'), PLASTERBOARD],
    framing: STUD_89,
  },
  {
    id: 'interior-140',
    name: 'Interior 140 mm',
    layers: [PLASTERBOARD, layer('140 mm stud', STUD_140.studDepth, 'core'), PLASTERBOARD],
    framing: STUD_140,
  },
  {
    id: 'wet-89',
    name: 'Wet wall 89 mm',
    layers: [CEMENT_BOARD_METRIC, layer('89 mm stud', STUD_89.studDepth, 'core'), PLASTERBOARD],
    framing: STUD_89,
  },
];

/** Presets offered first in each measurement system */
export const IMPERIAL_ASSEMBLY_IDS = ['interior-2x4', 'interior-2x6', 'wet-2x4', 'exterior-2x6'];
export const METRIC_ASSEMBLY_IDS = ['interior-89', 'interior-140', 'wet-89'];

export function totalThickness(assembly: WallAssembly): number {
  return assembly.layers.reduce((sum, l) => sum + l.thickness, 0);
}

/** Index of the core layer, or -1 when the assembly has none (invalid). */
export function coreIndex(assembly: WallAssembly): number {
  return assembly.layers.findIndex((l) => l.function === 'core');
}

/** Deep copy, so a plan never shares layer objects with the preset table. */
export function cloneAssembly(assembly: WallAssembly): WallAssembly {
  return {
    ...assembly,
    layers: assembly.layers.map((l) => ({ ...l })),
    framing: assembly.framing ? { ...assembly.framing } : undefined,
  };
}

export function presetAssembly(id: string): WallAssembly | undefined {
  const preset = ASSEMBLY_PRESETS.find((a) => a.id === id);
  return preset ? cloneAssembly(preset) : undefined;
}
