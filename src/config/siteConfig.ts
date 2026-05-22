export const siteConfig = {
  // Core Brand
  name: "DocStack",
  shortName: "DocStack",

  description: "Professional business templates and digital downloads.",

  tagline: "Professional digital products for creators, freelancers, and businesses.",

  // URLs
  url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",

  ogImage: "/og-image.png",

  // Company
  company: {
    legalName: "DocStack Ltd",
    address: {
      line1: "",
      line2: "",
      city: "London",
      postcode: "",
      country: "United Kingdom"
    },

    email: "support@docstack.com",
    supportEmail: "support@docstack.com",

    phone: "",

    hours: "Mon–Fri, 9am–5pm"
  },

  // SEO
  keywords: [
    "business templates",
    "digital downloads",
    "productivity templates",
    "ecommerce templates",
    "downloadable products",
    "Notion templates",
    "Canva templates"
  ],

  creator: "DocStack",
  publisher: "DocStack",

  authors: [
    {
      name: "DocStack Team"
    }
  ],

  // Socials
  social: {
    twitter: "",
    github: "",
    instagram: "",
    linkedin: ""
  },

  // Legal
  legal: {
    privacyPolicy: "/privacy-policy",
    terms: "/terms",
    refunds: "/refund-policy"
  },

  // Navigation
  nav: {
    main: [
      {
        title: "Products",
        href: "/products"
      },
      {
        title: "Categories",
        href: "/categories"
      },
      {
        title: "Contact",
        href: "/contact"
      }
    ]
  }
} as const;

export type SiteConfig = typeof siteConfig;
