import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn class helper. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
