export type RegistrationStatus = "open" | "closed" | "unknown" | "sold_out" | "waitlist";
export type Confidence = "high" | "medium" | "low";
export type SourceType = "website" | "event_page" | "rss" | "reddit" | "instagram_page" | "instagram_manual" | "facebook_page" | "manual" | "other";
export type ReviewStatus = "pending" | "saved" | "discarded";
export type AttendanceStatus = "interested" | "maybe" | "not_going" | "none";
export type EventClassification = "event_high_confidence" | "event_needs_review" | "possible_but_low_confidence" | "not_event";
export type TeamDecision = "interested" | "maybe" | "not_going";

export interface Organizer {
  id: string;
  name: string;
  instagramUrl?: string;
  websiteUrl?: string;
  facebookUrl?: string;
  redditUrl?: string;
  followerCount?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Event {
  id: string;
  sourceId?: string;
  organizerId?: string;
  name: string;
  description?: string;
  startDate: string;
  endDate?: string;
  timeText?: string;
  venueName?: string;
  address?: string;
  city?: string;
  state?: string;
  latitude?: number;
  longitude?: number;
  distanceMiles?: number;
  registrationStatus: RegistrationStatus;
  registrationUrl?: string;
  sourceUrl?: string;
  sourceType: SourceType;
  confidence: Confidence;
  needsReview: boolean;
  interested: boolean;
  maybe: boolean;
  notGoing: boolean;
  startTime?: string;
  endTime?: string;
  confirmedWorkerIds?: string[];
  eventCost?: number;
  paymentRecords?: PaymentRecord[];
  reminderEnabled: boolean;
  reminderOffsets: number[];
  reminderNotificationIds: number[];
  lastRegistrationStatus?: RegistrationStatus;
  lastNotifiedRegistrationStatus?: RegistrationStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentRecord {
  id: string;
  eventId: string;
  workerId: string;
  amountPaid: number;
  paidAt?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Worker {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Source {
  id: string;
  organizerId?: string;
  name: string;
  type: SourceType;
  url?: string;
  defaultVenueName?: string;
  defaultAddress?: string;
  defaultCity?: string;
  defaultState?: string;
  checkFrequencyLabel?: string;
  enabled: boolean;
  lastCheckedAt?: string;
  lastStatus?: string;
  lastError?: string;
  notes?: string;
  foundCount?: number;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ParsedEventCandidate {
  id: string;
  sourceId?: string;
  organizerId?: string;
  sourceUrl?: string;
  rawText: string;
  rawTextSnippet: string;
  eventName?: string;
  startDate?: string;
  endDate?: string;
  timeText?: string;
  venueName?: string;
  address?: string;
  city?: string;
  state?: string;
  registrationUrl?: string;
  registrationStatus: RegistrationStatus;
  confidence: Confidence;
  detectionScore: number;
  classification: EventClassification;
  reasons: string[];
  warnings: string[];
  matchedKeywords: string[];
  missingFields: string[];
  reviewStatus: ReviewStatus;
  notifiedAt?: string;
  createdAt: string;
}

export interface AppSettings {
  id: "settings";
  homeAddress: string;
  homeLatitude?: number;
  homeLongitude?: number;
  distanceUnit: "miles";
  notificationsEnabled: boolean;
  reminderOffsets: number[];
  quietHoursStart: string;
  quietHoursEnd: string;
  showLowConfidenceResults: boolean;
  refreshOnAppOpen: boolean;
  sourceRefreshIntervalHours: number;
  onboardingComplete: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EventDecision {
  id: string;
  eventId: string;
  userName: string;
  decision: TeamDecision;
  notes?: string;
  reminderEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GeocodeCache {
  address: string;
  latitude: number;
  longitude: number;
  checkedAt: string;
}

export interface ScrapeLog {
  id: string;
  sourceId?: string;
  sourceUrl?: string;
  rawTextSnippet: string;
  score: number;
  classification: EventClassification;
  reasons: string[];
  warnings: string[];
  matchedKeywords: string[];
  missingFields: string[];
  createdAt: string;
}
