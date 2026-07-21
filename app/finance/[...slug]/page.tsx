import { ComingSoon } from '@/components/workspace/coming-soon';
import { WORKSPACES } from '@/lib/workspaces/registry';

export default function FinanceFeaturePage({ params }: { params: { slug: string[] } }) {
  const href = `/finance/${params.slug.join('/')}`;
  const item = WORKSPACES.finance.navItems.find((n) => n.href === href);
  return <ComingSoon feature={item?.label ?? 'This page'} workspaceLabel={WORKSPACES.finance.label} />;
}
