import { loadDatasetFromDir, today_priorities } from '@/data';
import { Workspace } from '@/components/workspace/workspace';

// The data layer reads CSVs from disk, so this page is rendered dynamically.
export const dynamic = 'force-dynamic';

export default function Page() {
  const dataset = loadDatasetFromDir();
  const today = today_priorities(dataset);
  const regionCount = new Set(dataset.practices.map((p) => p.region)).size;

  return (
    <Workspace
      today={today}
      practiceCount={dataset.practices.length}
      regionCount={regionCount}
      latestMonth={today.monthLabel}
    />
  );
}
