/**
 * Deterministic "AI Thinking Engine" — runs requirement analysis and screen
 * discovery from the brief alone, with zero dependency on any external AI
 * provider. This guarantees the design pipeline always has a complete,
 * sensible plan even when no OpenRouter key is configured or the AI call
 * fails — the LLM agents (when available) enrich this plan, they never
 * replace it as the sole source of screens.
 */

export interface ProductProfile {
  productType: string;
  industry: string;
  personas: string[];
  roles: string[];
  modules: string[];
  /** Screens specific to this product type, in the order they should appear after auth/onboarding. */
  screens: string[];
}

const UNIVERSAL_PRE_SCREENS = ['Splash', 'Onboarding', 'Login', 'Signup', 'OTP Verification', 'Forgot Password'];
const UNIVERSAL_POST_SCREENS = [
  'Notifications', 'Settings', 'Profile', 'Support', 'About', 'Privacy Policy',
  'Empty State', 'Loading', 'Error',
];

interface ProductRule {
  keywords: RegExp;
  productType: string;
  industry: string;
  personas: string[];
  roles: string[];
  modules: string[];
  screens: string[];
}

const PRODUCT_RULES: ProductRule[] = [
  {
    keywords: /food|restaurant|delivery|meal|grocery|recipe/i,
    productType: 'Food Delivery App', industry: 'Food & Beverage',
    personas: ['Hungry Customer', 'Restaurant Partner', 'Delivery Rider'],
    roles: ['Customer', 'Restaurant Admin', 'Rider', 'Platform Admin'],
    modules: ['Restaurant Discovery', 'Menu & Ordering', 'Cart & Checkout', 'Live Order Tracking', 'Ratings & Reviews'],
    screens: ['Home', 'Search', 'Categories', 'Restaurant Detail', 'Product Details', 'Cart', 'Checkout', 'Payment', 'Order Tracking', 'Order History'],
  },
  {
    keywords: /shop|ecommerce|e-commerce|store|retail|marketplace|product catalog/i,
    productType: 'E-Commerce App', industry: 'Retail & E-Commerce',
    personas: ['Shopper', 'Seller', 'Store Admin'],
    roles: ['Buyer', 'Seller', 'Admin'],
    modules: ['Product Catalog', 'Cart & Checkout', 'Order Management', 'Wishlist', 'Reviews & Ratings'],
    screens: ['Home', 'Search', 'Categories', 'Product Details', 'Wishlist', 'Cart', 'Checkout', 'Payment', 'Order History', 'Order Tracking'],
  },
  {
    keywords: /bank|fintech|wallet|payment|finance|invest|loan|budget/i,
    productType: 'Banking / Fintech App', industry: 'Financial Services',
    personas: ['Account Holder', 'Business Owner', 'Compliance Officer'],
    roles: ['Customer', 'Business Account', 'Admin'],
    modules: ['Account Overview', 'Transfers & Payments', 'Cards Management', 'Transaction History', 'Budgeting'],
    screens: ['Dashboard', 'Accounts', 'Transfer Money', 'Pay Bills', 'Cards', 'Transaction History', 'Budgeting', 'Statements'],
  },
  {
    keywords: /social|community|feed|post|follow|chat|messenger|dating/i,
    productType: 'Social Media App', industry: 'Social & Community',
    personas: ['Content Creator', 'Casual User', 'Moderator'],
    roles: ['User', 'Creator', 'Moderator'],
    modules: ['Feed', 'Posting', 'Messaging', 'Follow Graph', 'Content Moderation'],
    screens: ['Feed', 'Create Post', 'Post Detail', 'Messages', 'Chat', 'Explore', 'Followers'],
  },
  {
    keywords: /learn|course|education|student|teacher|lms|quiz|classroom/i,
    productType: 'Education / LMS App', industry: 'Education',
    personas: ['Student', 'Instructor', 'Administrator'],
    roles: ['Student', 'Instructor', 'Admin'],
    modules: ['Course Catalog', 'Lessons & Video', 'Quizzes & Assessments', 'Progress Tracking', 'Certificates'],
    screens: ['Dashboard', 'Course Catalog', 'Course Detail', 'Lesson Player', 'Quiz', 'Progress', 'Certificates'],
  },
  {
    keywords: /health|clinic|doctor|patient|hospital|appointment|medical|fitness|workout|wellness/i,
    productType: 'Healthcare / Fitness App', industry: 'Health & Wellness',
    personas: ['Patient / Member', 'Doctor / Coach', 'Clinic Admin'],
    roles: ['Patient', 'Provider', 'Admin'],
    modules: ['Appointment Booking', 'Records / Progress Tracking', 'Messaging', 'Reminders'],
    screens: ['Dashboard', 'Book Appointment', 'Appointment Detail', 'Records', 'Progress Tracker', 'Messages', 'Reminders'],
  },
  {
    keywords: /travel|hotel|flight|booking|trip|tour|itinerary/i,
    productType: 'Travel & Booking App', industry: 'Travel & Hospitality',
    personas: ['Traveler', 'Host / Property Owner', 'Support Agent'],
    roles: ['Traveler', 'Host', 'Admin'],
    modules: ['Search & Discovery', 'Booking & Reservations', 'Itinerary Management', 'Reviews'],
    screens: ['Home', 'Search', 'Listing Detail', 'Booking', 'Payment', 'Itinerary', 'Trip History'],
  },
  {
    keywords: /real estate|property|listing|rent|apartment|realtor/i,
    productType: 'Real Estate App', industry: 'Real Estate',
    personas: ['Buyer / Renter', 'Agent', 'Property Manager'],
    roles: ['Buyer', 'Agent', 'Admin'],
    modules: ['Property Search', 'Listing Details', 'Scheduling Visits', 'Saved Listings'],
    screens: ['Home', 'Search', 'Property Detail', 'Saved Listings', 'Schedule Visit', 'Messages'],
  },
  {
    keywords: /ride|taxi|driver|cab|carpool|scooter/i,
    productType: 'Ride-Hailing App', industry: 'Transportation',
    personas: ['Rider', 'Driver', 'Fleet Admin'],
    roles: ['Rider', 'Driver', 'Admin'],
    modules: ['Ride Booking', 'Live Tracking', 'Fare & Payment', 'Trip History'],
    screens: ['Home', 'Book Ride', 'Live Tracking', 'Fare Summary', 'Payment', 'Trip History'],
  },
  {
    keywords: /job|career|hiring|recruit|resume|candidate/i,
    productType: 'Job Portal App', industry: 'Recruitment',
    personas: ['Job Seeker', 'Recruiter', 'Hiring Manager'],
    roles: ['Candidate', 'Recruiter', 'Admin'],
    modules: ['Job Search', 'Applications', 'Candidate Profile', 'Messaging'],
    screens: ['Home', 'Search Jobs', 'Job Detail', 'Applications', 'Candidate Profile', 'Messages'],
  },
];

const GENERIC_RULE: ProductRule = {
  keywords: /.*/,
  productType: 'SaaS / Business App', industry: 'General Business',
  personas: ['End User', 'Team Admin'],
  roles: ['User', 'Admin'],
  modules: ['Dashboard', 'Core Workflow', 'Reporting'],
  screens: ['Dashboard', 'Search', 'Detail', 'List', 'Create / Edit'],
};

export function detectProductProfile(brief: string): ProductProfile {
  const rule = PRODUCT_RULES.find((r) => r.keywords.test(brief)) ?? GENERIC_RULE;
  return {
    productType: rule.productType,
    industry: rule.industry,
    personas: rule.personas,
    roles: rule.roles,
    modules: rule.modules,
    screens: rule.screens,
  };
}

export interface DesignPlan {
  productType: string;
  industry: string;
  personas: string[];
  roles: string[];
  modules: string[];
  /** Full, deduplicated, ordered screen list: auth/onboarding → product screens → utility/account screens. */
  screens: string[];
  /** Linear happy-path the user follows through the app, screen names in order. */
  userJourney: string[];
  /** Named navigation edges (hub links) beyond the linear journey — e.g. bottom-nav destinations. */
  navigationFlow: Array<{ from: string; to: string; label: string }>;
}

function dedupePreserveOrder(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const key = n.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

export function buildDesignPlan(brief: string): DesignPlan {
  const profile = detectProductProfile(brief);
  const screens = dedupePreserveOrder([...UNIVERSAL_PRE_SCREENS, ...profile.screens, ...UNIVERSAL_POST_SCREENS]);

  const userJourney = dedupePreserveOrder([
    'Splash', 'Onboarding', 'Login',
    ...profile.screens.slice(0, Math.min(6, profile.screens.length)),
    'Profile',
  ]).filter((s) => screens.includes(s));

  const home = profile.screens[0] ?? 'Dashboard';
  const navigationFlow = [
    { from: home, to: 'Notifications', label: 'Bell icon' },
    { from: home, to: 'Profile', label: 'Avatar' },
    { from: 'Profile', to: 'Settings', label: 'Settings row' },
    { from: 'Settings', to: 'Support', label: 'Help & Support row' },
    { from: 'Login', to: 'Forgot Password', label: '"Forgot password?" link' },
    { from: 'Signup', to: 'OTP Verification', label: 'After submit' },
  ].filter((edge) => screens.includes(edge.from) && screens.includes(edge.to));

  return {
    productType: profile.productType,
    industry: profile.industry,
    personas: profile.personas,
    roles: profile.roles,
    modules: profile.modules,
    screens,
    userJourney,
    navigationFlow,
  };
}
