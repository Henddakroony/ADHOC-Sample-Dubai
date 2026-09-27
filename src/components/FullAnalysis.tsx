import { lazy, Suspense } from "react";
import type { Outlet } from "../types";
import type { RawField } from "../hooks/useFeatureLayer";

const Analytics = lazy(() => import("./Analytics"));
const BrandAnalysis = lazy(() => import("./BrandAnalysis"));

function Fallback({ label }: { label: string }) {
  return (
    <div className="view-loading">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  );
}

interface FullAnalysisProps {
  outlets: Outlet[];
  allFields: RawField[];
  rawRows: Record<string, unknown>[];
  filteredIds: Set<string>;
  objectIdField: string;
  statusField?: string;
  loading: boolean;
  onRefresh: () => void;
  onNeedFields?: (names: string[]) => void;
}

export default function FullAnalysis({
  outlets,
  allFields,
  rawRows,
  filteredIds,
  objectIdField,
  statusField,
  loading,
  onRefresh,
  onNeedFields,
}: FullAnalysisProps) {
  return (
    <div className="full-analysis-page">
      <Suspense fallback={<Fallback label="Loading analytics…" />}>
        <Analytics outlets={outlets} loading={loading} onRefresh={onRefresh} />
      </Suspense>
      <div className="full-analysis-divider" />
      <Suspense fallback={<Fallback label="Loading brand analysis…" />}>
        <BrandAnalysis
          allFields={allFields}
          rawRows={rawRows}
          filteredIds={filteredIds}
          objectIdField={objectIdField}
          statusField={statusField}
          loading={loading}
          onNeedFields={onNeedFields}
        />
      </Suspense>
    </div>
  );
}
