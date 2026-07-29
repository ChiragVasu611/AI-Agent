import {
  BarChart3, Briefcase, Bug, Calendar, CheckSquare, DollarSign, FileSearch, FileText, History, KanbanSquare, LayoutDashboard,
  PlayCircle, Search, Settings, Smartphone, Sparkles, Target, TrendingUp, Trophy, UserCheck, Users,
  type LucideIcon,
} from 'lucide-react';

export interface WorkspaceNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface WorkspaceConfig {
  key: string;
  label: string;
  subtitle: string;
  icon: LucideIcon;
  homeHref: string;
  navItems: WorkspaceNavItem[];
}

export const WORKSPACES: Record<string, WorkspaceConfig> = {
  hr: {
    key: 'hr',
    label: 'HR Workspace',
    subtitle: 'Recruitment, resume screening, interview assistance, and an HR copilot.',
    icon: Users,
    homeHref: '/hr',
    navItems: [
      { label: 'HR Dashboard', href: '/hr', icon: LayoutDashboard },
      { label: 'Employee Management', href: '/hr/employees', icon: Users },
      { label: 'Recruitment', href: '/hr/jobs', icon: Briefcase },
      { label: 'Candidates', href: '/hr/candidates', icon: UserCheck },
      { label: 'Interview Assistant', href: '/hr/interviews', icon: UserCheck },
      { label: 'Attendance', href: '/hr/attendance', icon: Calendar },
      { label: 'Performance', href: '/hr/performance', icon: TrendingUp },
      { label: 'HR Analytics', href: '/hr/analytics', icon: BarChart3 },
      { label: 'Settings', href: '/hr/settings', icon: Settings },
    ],
  },
  qa: {
    key: 'qa',
    label: 'QA Workspace',
    subtitle: 'Test execution, device labs, and quality analytics.',
    icon: FileSearch,
    homeHref: '/qa',
    navItems: [
      { label: 'QA Dashboard', href: '/qa', icon: LayoutDashboard },
      { label: 'Test Execution', href: '/qa/test-execution', icon: PlayCircle },
      { label: 'AI Test Case Execution', href: '/qa/test-case-execution', icon: Sparkles },
      { label: 'Test Runs', href: '/qa/runs', icon: History },
      { label: 'Analytics', href: '/qa/reports', icon: BarChart3 },
      { label: 'AI Issue Boards', href: '/qa/issue-boards', icon: KanbanSquare },
      { label: 'Devices', href: '/qa/devices', icon: Smartphone },
      { label: 'Crash Reports', href: '/qa/crash-reports', icon: Bug },
      { label: 'Settings', href: '/qa/settings', icon: Settings },
    ],
  },
  marketing: {
    key: 'marketing',
    label: 'Marketing Workspace',
    subtitle: 'Campaigns, content, and audience analytics.',
    icon: TrendingUp,
    homeHref: '/marketing',
    navItems: [
      { label: 'Marketing Dashboard', href: '/marketing', icon: LayoutDashboard },
      { label: 'Campaigns', href: '/marketing/campaigns', icon: Briefcase },
      { label: 'Analytics', href: '/marketing/analytics', icon: BarChart3 },
      { label: 'Settings', href: '/marketing/settings', icon: Settings },
    ],
  },
  finance: {
    key: 'finance',
    label: 'Finance Workspace',
    subtitle: 'Budgets, payroll, and financial reporting.',
    icon: DollarSign,
    homeHref: '/finance',
    navItems: [
      { label: 'Finance Dashboard', href: '/finance', icon: LayoutDashboard },
      { label: 'Payroll', href: '/finance/payroll', icon: DollarSign },
      { label: 'Reports', href: '/finance/reports', icon: BarChart3 },
      { label: 'Settings', href: '/finance/settings', icon: Settings },
    ],
  },
  app_factory: {
    key: 'app_factory',
    label: 'AI App Factory',
    subtitle: '8 autonomous agents analyze, plan, design, code, build, test, and ship.',
    icon: Briefcase,
    homeHref: '/app-factory',
    navItems: [
      { label: 'App Factory', href: '/app-factory', icon: LayoutDashboard },
      { label: 'AI Issue Boards', href: '/app-factory/issue-boards', icon: KanbanSquare },
      { label: 'Settings', href: '/app-factory/settings', icon: Settings },
    ],
  },
  designer: {
    key: 'designer',
    label: 'UI/UX Workspace',
    subtitle: 'Wireframes, design systems, and interactive prototypes from a brief.',
    icon: Users,
    homeHref: '/designer',
    navItems: [
      { label: 'UI/UX Designer', href: '/designer', icon: LayoutDashboard },
      { label: 'Settings', href: '/designer/settings', icon: Settings },
    ],
  },
  seo: {
    key: 'seo',
    label: 'SEO & ASO',
    subtitle: 'AI-driven SEO/ASO audits, keyword strategy, and growth planning — zero paid APIs.',
    icon: Target,
    homeHref: '/seo',
    navItems: [
      { label: 'SEO Dashboard', href: '/seo', icon: LayoutDashboard },
      { label: 'Projects', href: '/seo/projects', icon: Briefcase },
      { label: 'Keyword Engine', href: '/seo/keywords', icon: Search },
      { label: 'Tasks', href: '/seo/tasks', icon: CheckSquare },
      { label: 'Reports', href: '/seo/reports', icon: FileText },
      { label: 'Growth Coach', href: '/seo/growth', icon: Trophy },
      { label: 'Settings', href: '/seo/settings', icon: Settings },
    ],
  },
};
