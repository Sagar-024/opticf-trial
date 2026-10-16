'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Person } from '@/lib/people';
import { cn } from '@/lib/utils';

/**
 * The one people picker: the assign form's dropdown and the sheet send step
 * share it, so a name is chosen the same way everywhere. Single mode is the
 * assign form exactly as it was; multiple mode is the same name and role rows
 * extended into a quiet toggle list, for a sheet that goes to several people.
 * Both read the directory the caller passes, from src/lib/people.ts.
 */

type PeoplePickerProps = {
  label: string;
  people: Person[];
} & (
  | { multiple?: false; value: string; onChange: (name: string) => void }
  | { multiple: true; value: string[]; onChange: (names: string[]) => void }
);

export function PeoplePicker(props: PeoplePickerProps) {
  const { label, people } = props;

  if (props.multiple) {
    const { value, onChange } = props;
    function toggle(name: string): void {
      onChange(
        value.includes(name) ? value.filter((candidate) => candidate !== name) : [...value, name],
      );
    }

    return (
      <div role="group" aria-label={label}>
        <p className="label-caps mb-2">{label}</p>
        {/* Name boxes, not rows: tapping one flips its colour, and that is the
            whole selection signal. The role rides in the label for readers. */}
        <div className="flex flex-wrap gap-1.5">
          {people.map((person) => {
            const picked = value.includes(person.name);
            return (
              <button
                key={person.name}
                type="button"
                onClick={() => toggle(person.name)}
                aria-pressed={picked}
                aria-label={`${person.name}, ${person.role}`}
                className={cn(
                  'rounded-md border px-2.5 py-1.5 text-xs transition-colors',
                  picked
                    ? 'border-[color:var(--accent-border)] bg-[var(--accent-soft)] font-medium text-[var(--accent-text)]'
                    : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {person.name}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      <label className="label-caps mb-2 block">{label}</label>
      <Select value={props.value} onValueChange={props.onChange}>
        <SelectTrigger className="text-sm" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {people.map((person) => (
            <SelectItem key={person.name} value={person.name} className="text-xs">
              {person.name} · {person.role}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
