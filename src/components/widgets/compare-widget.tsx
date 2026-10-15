'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import type { CompareWidget as CompareWidgetPayload } from '@/ai/types';
import { CompareExplain, PracticeCompare } from '@/components/compare/practice-compare';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * The comparison as a chat widget: the graphic in the card, and the
 * explanation, when Explain is pressed, as its own block underneath it.
 */
export function CompareWidget({
  widget,
  notes,
  notesStreaming,
  onOpenBrain,
  onCompareOnMap,
}: {
  widget: CompareWidgetPayload;
  notes?: string[];
  notesStreaming?: boolean;
  onOpenBrain?: (documentTitle: string) => void;
  onCompareOnMap?: (practiceIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-2">
      <Card className="surface-3d">
        <CardContent className="p-4">
          <p className="label-caps">Compare practices</p>
          <PracticeCompare view={widget.view} className="mt-3" />
        </CardContent>
      </Card>

      <CompareExplain
        view={widget.view}
        notes={notes}
        open={open}
        onToggle={() => setOpen((value) => !value)}
        streaming={notesStreaming}
        onOpenBrain={onOpenBrain}
        onCompareOnMap={onCompareOnMap}
      />
    </div>
  );
}
