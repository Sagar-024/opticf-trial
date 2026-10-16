import { loadDatasetFromDir, today_priorities } from '@/data';
import { buildMapModel } from '@/data/map-model';
import { Workspace } from '@/components/workspace/workspace';

// The data layer reads CSVs from disk, so this page is rendered dynamically.
export const dynamic = 'force-dynamic';

export default function Page() {
  const dataset = loadDatasetFromDir();
  const today = today_priorities(dataset);
  const mapModel = buildMapModel(dataset);
  const regionCount = new Set(dataset.practices.map((p) => p.region)).size;
  const reportingCount = mapModel.practices.filter((practice) => practice.reported).length;

  return (
    <Workspace
      today={today}
      mapModel={mapModel}
      practiceCount={dataset.practices.length}
      reportingCount={reportingCount}
      regionCount={regionCount}
      latestMonth={today.monthLabel}
    />
  );
}
