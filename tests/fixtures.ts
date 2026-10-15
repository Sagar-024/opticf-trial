import type { Dataset } from '../src/domain/types';

/**
 * A small, hand-built dataset with known numbers, used for precise unit tests
 * of the pure functions (independent of the seeded generator).
 *
 * P1 (North West): revenue and conversion both fall; CL below target;
 *                  one required training module missing and overdue.
 * P2 (South East): revenue and conversion grow; CL above target; compliant.
 */
export function tinyDataset(): Dataset {
  return {
    practices: [
      {
        practiceId: 'P1',
        name: 'Alpha',
        region: 'North West',
        town: 'Manchester',
        postcode: 'M1 1',
        manager: 'Ada One',
        mentorId: 'M1',
        mentorName: 'Alex Morgan',
        openedYear: 2010,
        pmsSystem: 'VisionCore',
      },
      {
        practiceId: 'P2',
        name: 'Beta',
        region: 'South East',
        town: 'Oxford',
        postcode: 'OX1 1',
        manager: 'Bob Two',
        mentorId: 'M2',
        mentorName: 'Sam Ellis',
        openedYear: 2012,
        pmsSystem: 'VisionCore',
      },
    ],
    performance: [
      { practiceId: 'P1', month: '2026-08', revenue: 100000, revenueTarget: 100000, eyeExams: 1000, purchases: 700, conversionTarget: 64, clRevenue: 16000, clTarget: 14500 },
      { practiceId: 'P1', month: '2026-09', revenue: 80000, revenueTarget: 100000, eyeExams: 1000, purchases: 600, conversionTarget: 64, clRevenue: 10000, clTarget: 14500 },
      { practiceId: 'P2', month: '2026-08', revenue: 100000, revenueTarget: 100000, eyeExams: 1000, purchases: 650, conversionTarget: 64, clRevenue: 15000, clTarget: 14500 },
      { practiceId: 'P2', month: '2026-09', revenue: 110000, revenueTarget: 100000, eyeExams: 1000, purchases: 700, conversionTarget: 64, clRevenue: 17000, clTarget: 14500 },
    ],
    training: [
      { practiceId: 'P1', moduleId: 'CL-FIT', moduleName: 'Contact lens fitting', required: true, completed: true, completedDate: '2026-05-01', dueDate: '2026-09-30' },
      { practiceId: 'P1', moduleId: 'GDPR', moduleName: 'Data protection & GDPR', required: true, completed: false, completedDate: '', dueDate: '2026-08-31' },
      { practiceId: 'P2', moduleId: 'CL-FIT', moduleName: 'Contact lens fitting', required: true, completed: true, completedDate: '2026-06-01', dueDate: '2026-09-30' },
      { practiceId: 'P2', moduleId: 'GDPR', moduleName: 'Data protection & GDPR', required: true, completed: true, completedDate: '2026-06-01', dueDate: '2026-09-30' },
    ],
    refunds: [],
  };
}
