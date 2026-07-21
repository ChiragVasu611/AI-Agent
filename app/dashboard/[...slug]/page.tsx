import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { ComingSoon } from '@/components/workspace/coming-soon';

const ADMIN_ONLY_LABELS: Record<string, string> = {
  reports: 'Reports',
  users: 'Users',
  roles: 'Roles',
  permissions: 'Permissions',
  'audit-logs': 'Audit Logs',
};

export default async function DashboardFeaturePage({ params }: { params: { slug: string[] } }) {
  const key = params.slug[0];
  const label = ADMIN_ONLY_LABELS[key];

  if (label) {
    // Super Admin-only admin management screens — Company Admin can see the
    // rest of the Enterprise Dashboard but not user/role/permission management.
    const user = await getCurrentUser();
    if (user?.role !== 'super_admin') redirect('/403');
  }

  return <ComingSoon feature={label ?? 'This page'} workspaceLabel="Enterprise Dashboard" />;
}
