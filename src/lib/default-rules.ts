import type { Rule } from "./categorize";

export const DEFAULT_RULES: Rule[] = [
  { keyword: "CARREFOUR", category: "Courses" },
  { keyword: "LECLERC", category: "Courses" },
  { keyword: "INTERMARCHE", category: "Courses" },
  { keyword: "LIDL", category: "Courses" },
  { keyword: "AUCHAN", category: "Courses" },
  { keyword: "MONOPRIX", category: "Courses" },
  { keyword: "UBER EATS", category: "Restaurants" },
  { keyword: "DELIVEROO", category: "Restaurants" },
  { keyword: "MCDONALD", category: "Restaurants" },
  { keyword: "SNCF", category: "Transport" },
  { keyword: "UBER", category: "Transport" },
  { keyword: "RATP", category: "Transport" },
  { keyword: "TOTAL", category: "Transport" },
  { keyword: "NETFLIX", category: "Abonnements" },
  { keyword: "SPOTIFY", category: "Abonnements" },
  { keyword: "FREE", category: "Abonnements" },
  { keyword: "ORANGE", category: "Abonnements" },
  { keyword: "EDF", category: "Logement" },
  { keyword: "LOYER", category: "Logement" },
  { keyword: "AMAZON", category: "Loisirs" },
  { keyword: "FNAC", category: "Loisirs" },
];

export const DEFAULT_CATEGORIES = [
  "Courses",
  "Restaurants",
  "Transport",
  "Abonnements",
  "Logement",
  "Loisirs",
];
