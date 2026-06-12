import React from 'react';
import { UNIT_LABELS, type Unit } from '@tileflow/geometry';
import {
  formatDisplayFromMM,
  isImperialUnit,
  parseDisplayToMM,
  type ImperialFormat,
} from '../../utils/measurements';

/** Default arrow-key step per unit, in mm. */
const DEFAULT_STEP_MM: Record<Unit, number> = {
  mm: 1,
  cm: 10,
  m: 100,
  inches: 25.4,
  feet: 25.4,
};

/**
 * Compact inspector-style dimension input:
 * inline label, unit suffix, commit on blur/Enter,
 * Esc to revert, ↑/↓ to nudge (Shift = ×10).
 *
 * Values are always communicated in mm; display follows the unit
 * and imperial format passed in by the parent panel.
 */
export default function DimensionField({
  label,
  mm,
  unit,
  imperialFormat,
  onChangeMM,
  minMM = 0,
  stepMM,
  placeholder,
  title,
  className = '',
}: {
  label: string;
  mm: number;
  unit: Unit;
  imperialFormat: ImperialFormat;
  onChangeMM: (mm: number) => void;
  minMM?: number;
  stepMM?: number;
  placeholder?: string;
  title?: string;
  className?: string;
}) {
  const formatted = formatDisplayFromMM(mm, unit, imperialFormat);
  const [text, setText] = React.useState(formatted);

  React.useEffect(() => {
    setText(formatted);
  }, [formatted]);

  const commitMM = React.useCallback(
    (value: number) => {
      const clamped = Math.max(minMM, value);
      onChangeMM(clamped);
      setText(formatDisplayFromMM(clamped, unit, imperialFormat));
    },
    [minMM, onChangeMM, unit, imperialFormat]
  );

  const commit = React.useCallback(() => {
    const parsed = parseDisplayToMM(text, unit, imperialFormat);
    if (parsed !== null) {
      commitMM(parsed);
    } else {
      setText(formatted);
    }
  }, [text, unit, imperialFormat, commitMM, formatted]);

  const nudge = React.useCallback(
    (dir: 1 | -1, big: boolean) => {
      const step = (stepMM ?? DEFAULT_STEP_MM[unit]) * (big ? 10 : 1);
      const current = parseDisplayToMM(text, unit, imperialFormat) ?? mm;
      commitMM(current + dir * step);
    },
    [stepMM, unit, text, imperialFormat, mm, commitMM]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setText(formatted);
      e.currentTarget.blur();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      nudge(1, e.shiftKey);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      nudge(-1, e.shiftKey);
    }
  };

  // Imperial formats embed "ft"/"in" in the text itself.
  const suffix = isImperialUnit(unit) ? null : UNIT_LABELS[unit];

  return (
    <div
      title={title}
      className={`flex items-center bg-gray-800 border border-gray-700 rounded
                  focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500
                  transition-colors ${className}`}
    >
      <span className="pl-2 pr-1.5 text-[10px] font-semibold text-gray-500 select-none shrink-0">
        {label}
      </span>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        onFocus={(e) => e.target.select()}
        placeholder={placeholder}
        spellCheck={false}
        className="w-full min-w-0 bg-transparent py-1.5 text-sm text-gray-100 outline-none"
      />
      {suffix && (
        <span className="pr-2 pl-1 text-[10px] text-gray-500 select-none shrink-0">
          {suffix}
        </span>
      )}
    </div>
  );
}
