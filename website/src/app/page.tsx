'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { ToastProvider, useToast } from '../components/ui/Toast';
import { Navbar } from '../components/layout/Navbar';
import { ProjectBar } from '../components/layout/ProjectBar';
import { HeroStats } from '../components/dashboard/HeroStats';
import { ServiceCatalog } from '../components/dashboard/ServiceCatalog';
import { ActionCenter } from '../components/dashboard/ActionCenter';
import { LiveTimeline } from '../components/dashboard/LiveTimeline';
import { DashboardTopologyMap } from '../components/dashboard/DashboardTopologyMap';
import { AuthModal } from '../components/modals/AuthModal';
import { ScanModal } from '../components/modals/ScanModal';
import { DeleteModal } from '../components/modals/DeleteModal';
import { ServiceDetailModal } from '../components/modals/ServiceDetailModal';
import { ApiService } from '../services/api';
import { ProjectCatalogItem, ProjectOverview, StatusResponse, RepoDetail } from '../types/project';

function DashboardContent() {
  const { showToast } = useToast();

  // State
  const [projects, setProjects] = useState<ProjectCatalogItem[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState('');
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);

  // Modals
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isScanOpen, setIsScanOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [detailModalRepo, setDetailModalRepo] = useState<RepoDetail | null>(null);

  // Loading flags
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isLoadingOverview, setIsLoadingOverview] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Load registered projects
  const loadProjects = useCallback(
    async (preferredId?: string) => {
      try {
        setIsLoadingProjects(true);
        const data = await ApiService.getProjects();
        const list = data.registered_projects || [];
        setProjects(list);

        if (list.length > 0) {
          const defaultId = list[0].project_id || list[0].registry_path || '';
          const matchedPreferred =
            preferredId &&
            list.find(
              (p) =>
                (p.project_id && p.project_id.toLowerCase() === preferredId.toLowerCase()) ||
                (p.registry_path && p.registry_path.toLowerCase() === preferredId.toLowerCase())
            );
          const nextId =
            matchedPreferred
              ? matchedPreferred.project_id || matchedPreferred.registry_path || preferredId
              : currentProjectId && list.some((p) => (p.project_id || p.registry_path) === currentProjectId)
              ? currentProjectId
              : defaultId;

          setCurrentProjectId(nextId);
        } else {
          setCurrentProjectId('');
          setOverview(null);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to fetch projects list';
        showToast(msg, 'error');
      } finally {
        setIsLoadingProjects(false);
      }
    },
    [currentProjectId, showToast]
  );

  // Load overview & status data
  const loadOverview = useCallback(
    async (projectId: string) => {
      if (!projectId) return;
      try {
        setIsLoadingOverview(true);
        const [ovData, stData] = await Promise.all([
          ApiService.getOverview(projectId),
          ApiService.getStatus(projectId),
        ]);
        setOverview(ovData);
        setStatus(stData);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to load project overview';
        showToast(msg, 'error');
      } finally {
        setIsLoadingOverview(false);
      }
    },
    [showToast]
  );

  // Initial load
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // When active project changes, load overview
  useEffect(() => {
    if (currentProjectId) {
      loadOverview(currentProjectId);
    }
  }, [currentProjectId, loadOverview]);

  // Refresh handler
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([
      loadProjects(currentProjectId),
      currentProjectId ? loadOverview(currentProjectId) : Promise.resolve(),
    ]);
    setIsRefreshing(false);
    showToast('Dashboard reloaded', 'info');
  };

  const activeProjectItem = projects.find(
    (p) => (p.project_id || p.registry_path) === currentProjectId
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#090d16] text-gray-100 selection:bg-blue-500/30 selection:text-white">
      {/* Top Navbar */}
      <Navbar
        currentProject={activeProjectItem?.name || currentProjectId}
        gitUrl={overview?.git_url || activeProjectItem?.git_url}
        daemonActive={status?.daemon?.running ?? true}
        isRefreshing={isRefreshing}
        onRefresh={handleRefresh}
        onOpenAuth={() => setIsAuthOpen(true)}
      />

      {/* Project Bar */}
      <ProjectBar
        projects={projects}
        currentProjectId={currentProjectId}
        gitUrl={overview?.git_url || activeProjectItem?.git_url}
        onSelectProject={(id) => setCurrentProjectId(id)}
        onOpenScan={() => setIsScanOpen(true)}
        onOpenDelete={() => setIsDeleteOpen(true)}
      />

      {/* Hero Statistics */}
      <HeroStats overview={overview} loading={isLoadingOverview || isLoadingProjects} />

      {/* Main Content Layout */}
      <main className="flex-1 px-4 sm:px-6 pb-8 grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Visual Graph + Service Catalog */}
        <div className="lg:col-span-8 flex flex-col gap-5">
          {/* Calm, Interactive SVG Service Topology Whiteboard */}
          <DashboardTopologyMap
            overview={overview}
            onSelectRepo={(repo) => setDetailModalRepo(repo)}
          />

          {/* Service & Repository Catalog */}
          <ServiceCatalog
            repos={overview?.repos || []}
            onSelectRepo={(repo) => setDetailModalRepo(repo)}
          />
        </div>

        {/* Right Column: Action Center + Live Daemon Activity Stream */}
        <div className="lg:col-span-4 flex flex-col gap-5">
          <ActionCenter
            currentProject={currentProjectId}
            onRefresh={handleRefresh}
            onOpenDelete={() => setIsDeleteOpen(true)}
          />

          <LiveTimeline />
        </div>
      </main>

      {/* Modals */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onAuthChange={handleRefresh}
      />

      <ScanModal
        isOpen={isScanOpen}
        onClose={() => setIsScanOpen(false)}
        onScanComplete={(newId) => loadProjects(newId)}
      />

      <DeleteModal
        isOpen={isDeleteOpen}
        projectId={currentProjectId}
        projectName={overview?.project_name || activeProjectItem?.name}
        onClose={() => setIsDeleteOpen(false)}
        onDeleted={() => {
          setCurrentProjectId('');
          loadProjects();
        }}
      />

      <ServiceDetailModal
        isOpen={detailModalRepo !== null}
        repo={detailModalRepo}
        projectId={currentProjectId}
        onClose={() => setDetailModalRepo(null)}
        onReindexTriggered={handleRefresh}
      />
    </div>
  );
}

export default function DashboardPage() {
  return (
    <ToastProvider>
      <DashboardContent />
    </ToastProvider>
  );
}
