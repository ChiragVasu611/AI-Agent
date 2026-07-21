import { ComingSoon } from '@/components/workspace/coming-soon';
import { WORKSPACES } from '@/lib/workspaces/registry';

export default function MarketingFeaturePage({ params }: { params: { slug: string[] } }) {
  const href = `/marketing/${params.slug.join('/')}`;
  const item = WORKSPACES.marketing.navItems.find((n) => n.href === href);
  return <ComingSoon feature={item?.label ?? 'This page'} workspaceLabel={WORKSPACES.marketing.label} />;
}
