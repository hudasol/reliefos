import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MarketEventKind, MissionInput } from '../../../shared/contracts';
import type {
  AgentRun,
  Approval,
  AuditEvent,
  DeliveryTask,
  Mission,
  MissionDetail,
  MissionInterpretation,
  PaymentOperation,
  PolicyDecision,
  Proposal,
  PublicConfig,
  SecurityTestRun,
} from '../../../shared/types';
import { api } from './client';
import type {
  AnalyticsData,
  CandidateView,
  DrillOutcome,
  MissionReport,
  PlanOutcome,
  SecurityCatalog,
} from './types';

const m = (id: string) => `/api/missions/${id}`;

export const useConfig = () =>
  useQuery({
    queryKey: ['config'],
    queryFn: () => api.get<PublicConfig>('/api/config'),
    staleTime: 60_000,
  });
export const useSession = () =>
  useQuery({
    queryKey: ['session'],
    queryFn: () => api.get<{ workspaceId: string; created: boolean }>('/api/session'),
    staleTime: Infinity,
    retry: 1,
  });
export const useMissions = (enabled = true) =>
  useQuery({ queryKey: ['missions'], queryFn: () => api.get<Mission[]>('/api/missions'), enabled });

export const useMission = (id: string) =>
  useQuery({
    queryKey: ['mission', id, 'detail'],
    queryFn: () => api.get<MissionDetail>(m(id)),
    enabled: !!id,
  });
export const useMissionInput = (id: string) =>
  useQuery({
    queryKey: ['mission', id, 'input'],
    queryFn: () => api.get<{ version: number; input: MissionInput }>(`${m(id)}/input`),
    enabled: !!id,
  });
export const useCandidates = (id: string) =>
  useQuery({
    queryKey: ['mission', id, 'candidates'],
    queryFn: () => api.get<CandidateView[]>(`${m(id)}/candidates`),
  });
export const useSchedule = (id: string) =>
  useQuery({
    queryKey: ['mission', id, 'schedule'],
    queryFn: () =>
      api.get<{
        windowStart: string;
        deadline: string;
        timezone: string;
        destination: string;
        tasks: DeliveryTask[];
      }>(`${m(id)}/schedule`),
  });
export const useAudit = (id: string) =>
  useQuery({
    queryKey: ['mission', id, 'audit'],
    queryFn: () =>
      api.get<{
        events: AuditEvent[];
        chain: { intact: boolean; events: number; brokenAt: number | null };
      }>(`${m(id)}/audit`),
  });
export const useDecisions = (id: string) =>
  useQuery({
    queryKey: ['mission', id, 'decisions'],
    queryFn: () => api.get<PolicyDecision[]>(`${m(id)}/decisions`),
  });
export const useAgentRuns = (id: string) =>
  useQuery({
    queryKey: ['mission', id, 'agent-runs'],
    queryFn: () => api.get<AgentRun[]>(`${m(id)}/agent-runs`),
  });
export const useSecurityRuns = (id: string, pollMs: number | false = false) =>
  useQuery({
    queryKey: ['mission', id, 'security-runs'],
    queryFn: () => api.get<SecurityTestRun[]>(`${m(id)}/security-runs`),
    refetchInterval: pollMs,
  });
export const useSecurityCatalog = () =>
  useQuery({
    queryKey: ['security-catalog'],
    queryFn: () => api.get<SecurityCatalog>('/api/security/scenarios'),
    staleTime: Infinity,
  });
export const useAnalytics = (id: string) =>
  useQuery({
    queryKey: ['mission', id, 'analytics'],
    queryFn: () => api.get<AnalyticsData>(`${m(id)}/analytics`),
  });
export const useReport = (id: string) =>
  useQuery({
    queryKey: ['mission', id, 'report'],
    queryFn: () => api.get<MissionReport>(`${m(id)}/report`),
  });

function useMissionMutation<TVars, TResult>(id: string, fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ['mission', id] });
      await qc.invalidateQueries({ queryKey: ['missions'] });
    },
  });
}

export const usePlan = (id: string) =>
  useMissionMutation(id, (v: { refreshCatalog?: boolean }) =>
    api.post<PlanOutcome>(`${m(id)}/plan`, v),
  );
export const useRecover = (id: string) =>
  useMissionMutation(id, (proposalId: string) =>
    api.post<PlanOutcome>(`${m(id)}/proposals/${proposalId}/recover`),
  );
export const useApprove = (id: string) =>
  useMissionMutation(id, (v: { proposal: Proposal; approverName: string }) =>
    api.post<Approval>(`${m(id)}/proposals/${v.proposal.id}/approve`, {
      approverName: v.approverName,
      expectedContentHash: v.proposal.contentHash,
      expectedTotalCents: v.proposal.totalCents,
      acknowledged: true,
    }),
  );
export const useRejectProposal = (id: string) =>
  useMissionMutation(id, (v: { proposalId: string; reason: string }) =>
    api.post(`${m(id)}/proposals/${v.proposalId}/reject`, { reason: v.reason }),
  );
export const useCreatePayment = (id: string) =>
  useMissionMutation(id, (v: { proposalId: string; approvalId: string }) =>
    api.post<PaymentOperation>(`${m(id)}/proposals/${v.proposalId}/payments`, {
      approvalId: v.approvalId,
    }),
  );
export const useCapture = (id: string) =>
  useMissionMutation(id, (v: { opId: string; orderId: string }) =>
    api.post<PaymentOperation>(`${m(id)}/payments/${v.opId}/capture`, { orderId: v.orderId }),
  );
export const useReconcile = (id: string) =>
  useMissionMutation(id, (opId: string) =>
    api.post<PaymentOperation>(`${m(id)}/payments/${opId}/reconcile`),
  );
export const useCancelPayment = (id: string) =>
  useMissionMutation(id, (opId: string) =>
    api.post<PaymentOperation>(`${m(id)}/payments/${opId}/cancel`),
  );
export const useMarketEvent = (id: string) =>
  useMissionMutation(id, (kind: MarketEventKind) =>
    api.post<DrillOutcome>(`${m(id)}/events`, { kind }),
  );
export const useRunSecuritySuite = (id: string) =>
  useMissionMutation(id, () =>
    api.post<SecurityTestRun | { dispatched: 'render-workflows'; taskRunId: string }>(
      `${m(id)}/security-runs`,
    ),
  );
export const useUpdateMission = (id: string) =>
  useMissionMutation(id, (v: { expectedVersion: number; mission: MissionInput }) =>
    api.put<Mission>(m(id), v),
  );

export function useCreateMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MissionInput) => api.post<Mission>('/api/missions', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['missions'] }),
  });
}
export function useCreateScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Mission>('/api/missions/scenario'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['missions'] }),
  });
}
export const useInterpret = () =>
  useMutation({
    mutationFn: (narrative: string) =>
      api.post<MissionInterpretation & { error: string | null }>('/api/missions/interpret', {
        narrative,
      }),
  });
