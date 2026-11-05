import { describe, it, expect } from 'vitest';
import {
  ASSEMBLY_PRESETS,
  totalThickness,
  presetAssembly,
} from '../plan/assemblies';

describe('assembly presets', () => {
  it('stores lumber at actual size', () => {
    expect(totalThickness(presetAssembly('interior-2x4')!)).toBeCloseTo(114.3, 6);
    expect(totalThickness(presetAssembly('interior-2x6')!)).toBeCloseTo(165.1, 6);
    expect(totalThickness(presetAssembly('exterior-2x6')!)).toBeCloseTo(163.5125, 6);
    expect(totalThickness(presetAssembly('interior-89')!)).toBeCloseTo(114, 6);
  });

  it('every preset has exactly one core layer', () => {
    for (const a of ASSEMBLY_PRESETS) {
      expect(a.layers.filter((l) => l.function === 'core')).toHaveLength(1);
    }
  });

  it('hands out copies, not the preset itself', () => {
    const a = presetAssembly('wet-2x4')!;
    a.layers[0].thickness = 1;
    expect(presetAssembly('wet-2x4')!.layers[0].thickness).toBeCloseTo(12.7, 6);
  });
});
