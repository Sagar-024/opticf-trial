'use client';

import { motion, type Variants } from 'framer-motion';
import type { KpiWidget, TableWidget, Widget } from '@/ai/types';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartWidget } from './chart-widget';

/** Widget internals cascade: a different rhythm from the chat's own stagger. */
const cascade: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

const cascadeItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } },
};

function Kpi({ widget }: { widget: KpiWidget }) {
  return (
    <Card className="surface-card shadow-none">
      <CardContent className="p-4">
        <p className="label-caps mb-3">{widget.title}</p>
        <motion.div className="grid grid-cols-2 gap-3 sm:grid-cols-4" variants={cascade} initial="hidden" animate="show">
          {widget.items.map((item) => (
            <motion.div key={item.label} variants={cascadeItem}>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{item.label}</p>
              <p className="mt-0.5 text-lg font-semibold leading-tight">{item.value}</p>
              {item.sub ? <p className="text-[11px] text-muted-foreground">{item.sub}</p> : null}
            </motion.div>
          ))}
        </motion.div>
      </CardContent>
    </Card>
  );
}

function DataTable({ widget }: { widget: TableWidget }) {
  return (
    <Card className="surface-card overflow-hidden shadow-none">
      <CardContent className="p-4">
        <p className="label-caps mb-3">{widget.title}</p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {widget.columns.map((column) => (
                  <TableHead key={column} className="whitespace-nowrap text-[11px]">{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {widget.rows.map((row, rowIndex) => (
                <motion.tr
                  key={rowIndex}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  // Rows cascade but the delay is capped, so a long table never crawls.
                  transition={{ duration: 0.24, delay: Math.min(rowIndex * 0.03, 0.3) }}
                  className="border-b transition-colors hover:bg-muted/40"
                >
                  {row.map((cell, cellIndex) => (
                    <TableCell key={cellIndex} className="whitespace-nowrap text-xs">{cell}</TableCell>
                  ))}
                </motion.tr>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export function WidgetRenderer({ widget }: { widget: Widget }) {
  if (widget.type === 'kpi') return <Kpi widget={widget} />;
  if (widget.type === 'chart') return <ChartWidget widget={widget} />;
  return <DataTable widget={widget} />;
}
