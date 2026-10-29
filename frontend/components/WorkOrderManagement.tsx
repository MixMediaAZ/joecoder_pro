'use client'

import { Activity } from 'lucide-react'
import type { WorkOrder } from '../lib/backendTypes'

export function WorkOrderManagement({ workOrders = [] }: { workOrders?: WorkOrder[] }) {

  return (
    <div className="flex h-full flex-col bg-[#050505]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#0B0B0C]">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-gray-400" />
          <span className="text-sm text-gray-400">Recorded Work</span>
        </div>
        <span className="text-xs text-gray-500">{workOrders.length} items</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {workOrders.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Activity className="h-12 w-12 mx-auto mb-4 text-gray-600" />
              <p className="text-gray-400">No work recorded yet</p>
            </div>
          </div>
        ) : (
          workOrders.map((workOrder) => (
            <div
              key={workOrder.id}
              className="px-4 py-3 border-b border-white/10 hover:bg-white/5 transition-colors"
            >
              <div className="mb-1 flex items-start justify-between">
                <h3 className="text-sm font-semibold text-gray-200">{workOrder.objective}</h3>
                <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-gray-300">{workOrder.status}</span>
              </div>
              <p className="text-xs text-gray-500">Intent: {workOrder.intent}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}