import { ComingSoon } from '@/components/workspace/coming-soon';
import { WORKSPACES } from '@/lib/workspaces/registry';

export default function QaFeaturePage({ params }: { params: { slug: string[] } }) {
  const href = `/qa/${params.slug.join('/')}`;
  const item = WORKSPACES.qa.navItems.find((n) => n.href === href);
  return <ComingSoon feature={item?.label ?? 'This page'} workspaceLabel={WORKSPACES.qa.label} />;
}
