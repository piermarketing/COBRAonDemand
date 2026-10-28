import type { SetupModule } from "@cod/db";

export const MODULE_INFO: Record<SetupModule, { title: string; body: string; required: boolean | "conditional" }> = {
  company_profile: { title: "Company profile", body: "Legal name, address, EIN, plan year and plan administrator.", required: true },
  employees: { title: "Set up employees", body: "Census: names, DOB, addresses, hire and termination dates.", required: true },
  dependents: { title: "Set up dependents", body: "Spouses and children, with their own address if different.", required: true },
  plans: { title: "Set up plans", body: "Carriers, plans, tiers and total monthly rates.", required: true },
  elections: { title: "Set up current elections", body: "Who is enrolled in which plan and tier.", required: true },
  current_cobra: { title: "Current COBRA enrollees", body: "Take over people already on COBRA with another administrator.", required: "conditional" },
  admin_users: { title: "Admin users and notifications", body: "Team members, roles, and who confirms terminations.", required: true },
  billing: { title: "Billing", body: "Card or bank account for COBRA on Demand fees.", required: true },
  automation: { title: "Automation settings", body: "Send packets immediately or hold for a one-tap confirm; company-paid COBRA.", required: false },
  review: { title: "Review and go live", body: "Summary and go-live.", required: true },
};
