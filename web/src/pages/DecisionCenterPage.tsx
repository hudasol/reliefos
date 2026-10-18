import { useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  themeQuartz,
  type ColDef,
  type ValueFormatterParams,
} from 'ag-grid-community';
import { AllEnterpriseModule } from 'ag-grid-enterprise';
import { AgChartsEnterpriseModule } from 'ag-charts-enterprise';
import { AgStudio, AgStudioProvider, createWidgets } from 'ag-studio-react';
import type { AgDefaultRegistry, AgStudioApi, AgWidgetsConfig } from 'ag-studio';
import { useAnalytics, useConfig, useMission } from '../api/hooks';
import type { AnalyticsData } from '../api/types';
import { Badge, Callout, Panel, QueryView } from '../components/ui';
import { buildStudioData } from '../features/studio/data';
import { missionReport, PAGES } from '../features/studio/report';
import { reliefStudioTheme } from '../features/studio/theme';
import {
  authorityWidgetDefinition,
  gateWidgetDefinition,
  type StudioContext,
} from '../features/studio/widgets';

const gridModules = [AllCommunityModule, AllEnterpriseModule.with(AgChartsEnterpriseModule)];

const gridTheme = themeQuartz.withParams({
  fontFamily: 'var(--font)',
  fontSize: 12.5,
  accentColor: '#2459c4',
  headerBackgroundColor: '#fbfaf7',
  headerTextColor: '#4b5462',
  borderColor: '#e3dfd6',
  rowHoverColor: '#f6f4ef',
  backgroundColor: '#ffffff',
  oddRowBackgroundColor: '#fdfcfa',
  spacing: 6,
  wrapperBorderRadius: 0,
});

const money = (p: ValueFormatterParams) =>
  p.value == null
    ? ''
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
        p.value as number,
      );
const yesNo = (p: ValueFormatterParams) => (p.value == null ? '' : p.value ? 'Yes' : 'No');

type Row = AnalyticsData['candidates'][number];
type LineRow = AnalyticsData['lines'][number];

function SourcingGrid({ rows }: { rows: Row[] }) {
  const cols = useMemo<ColDef<Row>[]>(
    () => [
      { field: 'requirement', rowGroup: true, hide: true },
      { field: 'product', minWidth: 280, filter: 'agTextColumnFilter', tooltipField: 'product' },
      { field: 'merchant', filter: 'agSetColumnFilter' },
      { field: 'provenance', headerName: 'Source', filter: 'agSetColumnFilter', width: 120 },
      {
        field: 'listedPrice',
        headerName: 'Listed',
        valueFormatter: money,
        type: 'rightAligned',
        aggFunc: 'min',
        width: 110,
      },
      { field: 'unitsPerPack', headerName: 'Units/pack', type: 'rightAligned', width: 110 },
      {
        field: 'costPerUnit',
        headerName: 'Cost/unit',
        valueFormatter: money,
        type: 'rightAligned',
        aggFunc: 'min',
        width: 110,
        sort: 'asc',
      },
      { field: 'stockPacks', headerName: 'Stock (sim)', type: 'rightAligned', width: 110 },
      {
        field: 'eligible',
        valueFormatter: yesNo,
        filter: 'agSetColumnFilter',
        width: 100,
        cellStyle: (p) =>
          p.value === false
            ? { color: '#7a818c', fontWeight: 400 }
            : { color: '#1d7347', fontWeight: 600 },
      },
      {
        field: 'selected',
        headerName: 'In plan',
        valueFormatter: yesNo,
        width: 95,
        cellStyle: (p) => (p.value ? { color: '#2459c4', fontWeight: 600 } : null),
      },
      {
        field: 'quarantined',
        valueFormatter: yesNo,
        width: 110,
        cellStyle: (p) => (p.value ? { color: '#b1261b', fontWeight: 700 } : null),
      },
      {
        field: 'suitability',
        headerName: 'Agent score',
        type: 'rightAligned',
        width: 110,
        aggFunc: 'max',
      },
      {
        field: 'exclusion',
        headerName: 'First exclusion reason',
        minWidth: 320,
        tooltipField: 'exclusion',
        filter: 'agTextColumnFilter',
      },
    ],
    [],
  );
  return (
    <div className="grid-frame">
      <AgGridReact<Row>
        theme={gridTheme}
        rowData={rows}
        columnDefs={cols}
        getRowId={(p) => p.data.id}
        defaultColDef={{
          sortable: true,
          resizable: true,
          filter: true,
          enableRowGroup: true,
          enableValue: true,
        }}
        autoGroupColumnDef={{
          headerName: 'Requirement',
          minWidth: 260,
          cellRendererParams: { suppressCount: false },
        }}
        groupDefaultExpanded={1}
        rowGroupPanelShow="always"
        sideBar={{ toolPanels: ['columns', 'filters'], defaultToolPanel: '' }}
        cellSelection
        enableCharts
        statusBar={{
          statusPanels: [
            { statusPanel: 'agTotalAndFilteredRowCountComponent' },
            { statusPanel: 'agAggregationComponent' },
          ],
        }}
        tooltipShowDelay={300}
      />
    </div>
  );
}

function LinesGrid({ rows }: { rows: LineRow[] }) {
  const cols = useMemo<ColDef<LineRow>[]>(
    () => [
      { field: 'proposalVersion', headerName: 'Version', rowGroup: true, hide: true, sort: 'desc' },
      { field: 'proposalStatus', headerName: 'Status', width: 140 },
      { field: 'requirement', minWidth: 220 },
      { field: 'product', minWidth: 260, tooltipField: 'product' },
      { field: 'merchant' },
      { field: 'provenance', headerName: 'Source', width: 110 },
      { field: 'packs', type: 'rightAligned', aggFunc: 'sum', width: 90 },
      { field: 'units', type: 'rightAligned', aggFunc: 'sum', width: 100 },
      {
        field: 'unitPrice',
        headerName: 'Unit',
        valueFormatter: money,
        type: 'rightAligned',
        width: 100,
      },
      {
        field: 'currentUnitPrice',
        headerName: 'Current unit',
        valueFormatter: money,
        type: 'rightAligned',
        width: 120,
        cellStyle: (p) =>
          p.data && p.data.currentUnitPrice !== p.data.unitPrice
            ? { color: '#b1261b', fontWeight: 700 }
            : null,
      },
      {
        field: 'lineTotal',
        headerName: 'Line total',
        valueFormatter: money,
        type: 'rightAligned',
        aggFunc: 'sum',
        width: 120,
      },
      {
        field: 'slackMinutes',
        headerName: 'Slack (min)',
        type: 'rightAligned',
        width: 110,
        aggFunc: 'min',
        cellStyle: (p) =>
          typeof p.value === 'number' && p.value < 0
            ? { color: '#b1261b', fontWeight: 700 }
            : typeof p.value === 'number' && p.value < 45
              ? { color: '#9a5b0c', fontWeight: 400 }
              : null,
      },
      { field: 'deliveryStatus', headerName: 'Delivery', width: 120 },
    ],
    [],
  );
  return (
    <div className="grid-frame">
      <AgGridReact<LineRow>
        theme={gridTheme}
        rowData={rows}
        columnDefs={cols}
        getRowId={(p) => p.data.id}
        defaultColDef={{
          sortable: true,
          resizable: true,
          filter: true,
          enableRowGroup: true,
          enableValue: true,
        }}
        autoGroupColumnDef={{
          headerName: 'Proposal',
          minWidth: 160,
          valueFormatter: (p) => (p.value != null ? `v${p.value}` : ''),
        }}
        groupDefaultExpanded={0}
        isGroupOpenByDefault={(p) =>
          p.level === 0 && p.rowNode.allLeafChildren?.[0]?.data?.isActive === true
        }
        grandTotalRow="bottom"
        sideBar={{ toolPanels: ['columns', 'filters'], defaultToolPanel: '' }}
        cellSelection
        enableCharts
        statusBar={{ statusPanels: [{ statusPanel: 'agAggregationComponent' }] }}
      />
    </div>
  );
}

function StudioDashboard({
  a,
  context,
  licenseKey,
}: {
  a: AnalyticsData;
  context: StudioContext;
  licenseKey: string | null;
}) {
  const apiRef = useRef<AgStudioApi | null>(null);
  const [page, setPage] = useState<string>('mission');
  const data = useMemo(() => buildStudioData(a), [a]);
  const widgets = useMemo(
    () => (cfg: AgWidgetsConfig<AgDefaultRegistry>) =>
      createWidgets({
        additionalTypes: [authorityWidgetDefinition, gateWidgetDefinition],
        menu: [...cfg.menu, { label: 'RELIEFOS', widgetIds: ['relief-authority', 'relief-gate'] }],
      } as never) as never,
    [],
  );
  const [initialState] = useState(() => missionReport);
  return (
    <div className="stack" style={{ gap: 0 }}>
      <div
        className="tabs"
        role="tablist"
        aria-label="Dashboard pages"
        style={{ padding: '0 12px', background: 'var(--surface)' }}
      >
        {PAGES.map((p) => (
          <button
            key={p.id}
            role="tab"
            className="tab"
            aria-selected={page === p.id}
            onClick={() => {
              setPage(p.id);
              const api = apiRef.current;
              if (api) api.setState({ ...api.getState(), selectedPageId: p.id });
            }}
          >
            {p.title}
          </button>
        ))}
      </div>
      <div className="studio-frame">
        <AgStudioProvider licenseKey={licenseKey ?? undefined}>
          <AgStudio
            style={{ height: '100%', width: '100%' }}
            theme={reliefStudioTheme}
            layout={{ widgetBorderEnabled: true }}
            data={data}
            widgets={widgets}
            context={context}
            initialState={initialState}
            mode="view"
            onApiReady={(e: { api: AgStudioApi }) => {
              apiRef.current = e.api;
            }}
          />
        </AgStudioProvider>
      </div>
    </div>
  );
}

export default function DecisionCenterPage() {
  const { missionId } = useParams();
  const aq = useAnalytics(missionId!);
  const mq = useMission(missionId!);
  const config = useConfig();
  const [tab, setTab] = useState<'studio' | 'sourcing' | 'lines'>('studio');

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>Decision center</h1>
          <p className="lede">
            Interactive analytics over persisted mission state: every listing evaluated, every
            proposal line, every policy check and payment. Figures come from the same server-side
            calculations the policy gate uses.
          </p>
        </div>
      </div>
      {config.data && !config.data.agStudioLicenseKey && (
        <Callout tone="info">
          AG Studio and AG Grid Enterprise are running without a licence key on this deployment, so
          they show an evaluation watermark. Functionality is unaffected.
        </Callout>
      )}
      <div className="tabs" role="tablist">
        <button
          role="tab"
          className="tab"
          aria-selected={tab === 'studio'}
          onClick={() => setTab('studio')}
        >
          Mission dashboard{' '}
          <Badge plain tone="accent">
            AG Studio
          </Badge>
        </button>
        <button
          role="tab"
          className="tab"
          aria-selected={tab === 'sourcing'}
          onClick={() => setTab('sourcing')}
        >
          Sourcing grid
        </button>
        <button
          role="tab"
          className="tab"
          aria-selected={tab === 'lines'}
          onClick={() => setTab('lines')}
        >
          Proposal lines
        </button>
      </div>
      <QueryView q={aq} rows={10}>
        {(a) => (
          <AgGridProvider
            modules={gridModules}
            licenseKey={config.data?.agGridLicenseKey ?? undefined}
          >
            {tab === 'studio' && mq.data && (
              <Panel flush>
                {a.lines.length === 0 && a.candidates.length === 0 ? (
                  <div className="panel-body muted">
                    Plan the mission to populate the dashboard.
                  </div>
                ) : (
                  <StudioDashboard
                    a={a}
                    licenseKey={config.data?.agStudioLicenseKey ?? null}
                    context={{
                      summary: a.summary,
                      decision: mq.data.activeProposal?.latestDecision ?? null,
                      proposalVersion: mq.data.activeProposal?.version ?? null,
                    }}
                  />
                )}
              </Panel>
            )}
            {tab === 'sourcing' && (
              <Panel
                title="Every listing, grouped by requirement"
                sub="Group, pivot, filter, chart a selection (right-click)"
                flush
              >
                <SourcingGrid rows={a.candidates} />
              </Panel>
            )}
            {tab === 'lines' && (
              <Panel
                title="Proposal lines across versions"
                sub="Red current price = changed after selection; negative slack = late"
                flush
              >
                <LinesGrid rows={a.lines} />
              </Panel>
            )}
          </AgGridProvider>
        )}
      </QueryView>
    </div>
  );
}
