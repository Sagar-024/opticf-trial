'use client';

import type { KpiWidget, TableWidget, Widget } from '@/ai/types';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartWidget } from './chart-widget';

function Kpi({ widget }: { widget: KpiWidget }) {
  return (
    <Card className="shadow-panel">
      <CardContent className="p-4">
        <p className="label-caps mb-3">{widget.title}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {widget.items.map((item) => (
            <div key={item.label}>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{item.label}</p>
              <p className="mt-0.5 text-lg font-semibold leading-tight">{item.value}</p>
              {item.sub ? <p className="text-[11px] text-muted-foreground">{item.sub}</p> : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function DataTable({ widget }: { widget: TableWidget }) {
  return (
    <Card className="overflow-hidden shadow-panel">
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
                <TableRow key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <TableCell key={cellIndex} className="whitespace-nowrap text-xs">{cell}</TableCell>
                  ))}
                </TableRow>
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
