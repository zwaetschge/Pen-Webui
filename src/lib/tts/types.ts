import { z } from "zod";

export const voiceTargetTypeSchema = z.enum(["narrator", "npc", "character"]);
export type VoiceTargetType = z.infer<typeof voiceTargetTypeSchema>;

export const voiceTargetSchema = z.object({
  targetType: voiceTargetTypeSchema,
  targetId: z.string().min(1).max(160),
});
export type VoiceTarget = z.infer<typeof voiceTargetSchema>;

export const voiceAssignmentInputSchema = z.object({
  targetType: voiceTargetTypeSchema,
  targetId: z.string().min(1).max(160),
  voiceId: z.string().min(1).max(160),
});

export const voiceAssignmentsPutSchema = z.object({
  assignments: z.array(voiceAssignmentInputSchema).min(1).max(50),
});

export type VoiceAssignmentInput = z.infer<typeof voiceAssignmentInputSchema>;

export type VocariumVoice = {
  voiceId: string;
  name: string;
  language: string | null;
  source: "clone";
  vocariumUser: string;
};

export type StoredVoiceAssignment = {
  targetType: VoiceTargetType;
  targetId: string;
  vocariumUser: string;
  voiceId: string;
  voiceName: string;
  voiceSource: string;
};
