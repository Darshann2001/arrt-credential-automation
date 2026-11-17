"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RotateCcw } from "lucide-react";
import {
  API_BASE_URL,
  describeError,
  getAllRecords,
  getRecords,
} from "@/lib/api";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  RECORD_SORT_OPTIONS,
  sortOptionValue,
  US_STATES,
} from "@/lib/constants";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import type {
  CredentialRecord,
  PaginationMeta,
  RecordSortField,
  SortOrder,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { RecordsTable } from "./records-table";
import { csvFilename, downloadCsv, recordsToCsv } from "@/lib/csv";

const EMPTY_PAGINATION: PaginationMeta = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

export function RecordsExplorer() {
  const { push } = useToast();

  const [searchInput, setSearchInput] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [cityInput, setCityInput] = useState("");
  const [credentialInput, setCredentialInput] = useState("");
  const [sortOption, setSortOption] = useState("createdAt:desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [reloadToken, setReloadToken] = useState(0);

  const [records, setRecords] = useState<CredentialRecord[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>(EMPTY_PAGINATION);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useDebouncedValue(searchInput, 350);
  const city = useDebouncedValue(cityInput, 350);
  const credential = useDebouncedValue(credentialInput, 350);

  const { sortBy, sortOrder } = useMemo(() => {
    const option = RECORD_SORT_OPTIONS.find((item) => item.value === sortOption);

    return {
      sortBy: option?.sortBy ?? ("createdAt" as RecordSortField),
      sortOrder: option?.sortOrder ?? ("desc" as SortOrder),
    };
  }, [sortOption]);

  const filtersActive = Boolean(searchInput || stateFilter || cityInput || credentialInput);

  const resetPage = useCallback(() => setPage(1), []);

  function clearFilters() {
    setSearchInput("");
    setStateFilter("");
    setCityInput("");
    setCredentialInput("");
    setPage(1);
  }

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError(null);

    getRecords(
      {
        page,
        pageSize,
        search,
        state: stateFilter,
        city,
        credential,
        sortBy,
        sortOrder,
      },
      controller.signal
    )
      .then((response) => {
        if (!active) return;
        setRecords(response.data);
        setPagination(response.pagination);

        if (page > Math.max(response.pagination.totalPages, 1)) {
          setPage(1);
        }
      })
      .catch((caught: unknown) => {
        if (!active || controller.signal.aborted) return;
        setError(describeError(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    page,
    pageSize,
    search,
    stateFilter,
    city,
    credential,
    sortBy,
    sortOrder,
    reloadToken,
  ]);

  function handleSort(field: RecordSortField) {
    if (field === sortBy) {
      setSortOption(sortOptionValue(field, sortOrder === "asc" ? "desc" : "asc"));
      return;
    }

    const matching = RECORD_SORT_OPTIONS.find((option) => option.sortBy === field);
    setSortOption(matching?.value ?? sortOptionValue(field, "asc"));
    setPage(1);
  }

  async function handleExport() {
    setExporting(true);

    try {
      const result = await getAllRecords({
        search,
        state: stateFilter,
        city,
        credential,
        sortBy,
        sortOrder,
      });

      if (result.records.length === 0) {
        push({
          tone: "info",
          title: "Nothing to export",
          description: "No records match the current filters.",
        });
        return;
      }

      downloadCsv(csvFilename(), recordsToCsv(result.records));

      push({
        tone: result.truncated ? "info" : "success",
        title: `Exported ${result.records.length.toLocaleString()} rows`,
        description: result.truncated
          ? `The export was capped at 10,000 rows. ${result.total.toLocaleString()} records match the filters; narrow the filters to export the rest.`
          : "The CSV includes all records matching the current filters.",
      });
    } catch (caught) {
      push({
        tone: "error",
        title: "Export failed",
        description: describeError(caught),
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Credential Records"
        description="Search, filter, sort and export the credential records currently stored by the API."
        actions={
          <Button
            variant="secondary"
            onClick={() => void handleExport()}
            loading={exporting}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Export CSV
          </Button>
        }
      />

      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Input
            label="Search name"
            placeholder="Full or partial name"
            value={searchInput}
            maxLength={120}
            onChange={(event) => {
              setSearchInput(event.target.value);
              resetPage();
            }}
          />

          <Select
            label="State"
            value={stateFilter}
            onChange={(event) => {
              setStateFilter(event.target.value);
              resetPage();
            }}
          >
            <option value="">All states</option>
            {US_STATES.map((state) => (
              <option key={state.code} value={state.code}>
                {state.name} ({state.code})
              </option>
            ))}
          </Select>

          <Input
            label="City"
            placeholder="Any city"
            value={cityInput}
            maxLength={80}
            onChange={(event) => {
              setCityInput(event.target.value);
              resetPage();
            }}
          />

          <Input
            label="Credential"
            placeholder="e.g. R.T.(R)"
            value={credentialInput}
            maxLength={100}
            onChange={(event) => {
              setCredentialInput(event.target.value);
              resetPage();
            }}
          />

          <Select
            label="Sort by"
            value={sortOption}
            onChange={(event) => {
              setSortOption(event.target.value);
              resetPage();
            }}
          >
            {RECORD_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label
                htmlFor="records-page-size"
                className="text-sm text-slate-500"
              >
                Rows per page
              </label>
              <select
                id="records-page-size"
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  resetPage();
                }}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              disabled={!filtersActive}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Clear filters
            </Button>
          </div>

          <p className="text-xs text-slate-400">
            API: {API_BASE_URL}/api/records
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={`${pagination.total.toLocaleString()} matching records`}
          description="Rows tagged ‘Demo data’ come from a demo/seed source value; all other source labels represent imported data."
        />

        {error ? (
          <div className="p-5">
            <ErrorState
              title="Records could not be loaded"
              message={error}
              onRetry={() => setReloadToken((value) => value + 1)}
            />
          </div>
        ) : !loading && records.length === 0 ? (
          <EmptyState
            title={filtersActive ? "No records match these filters" : "No credential records yet"}
            description={
              filtersActive
                ? "Try removing a filter or clearing the search to see more records."
                : "Records appear here after they are imported through the backend API."
            }
            action={
              filtersActive ? (
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <RecordsTable
              records={records}
              loading={loading}
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={handleSort}
            />
            <Pagination
              pagination={pagination}
              onPageChange={setPage}
              itemLabel="records"
              disabled={loading}
            />
          </>
        )}
      </Card>
    </div>
  );
}
