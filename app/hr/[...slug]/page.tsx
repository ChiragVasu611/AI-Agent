import { ComingSoon } from '@/components/workspace/coming-soon';
import { WORKSPACES } from '@/lib/workspaces/registry';

export default function HrFeaturePage({ params }: { params: { slug: string[] } }) {
  const href = `/hr/${params.slug.join('/')}`;
  const item = WORKSPACES.hr.navItems.find((n) => n.href === href);
  return <ComingSoon feature={item?.label ?? 'This page'} workspaceLabel={WORKSPACES.hr.label} />;
}
