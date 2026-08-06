import { getAdminOrdersAndMetrics, getAdminProducts } from "@/queries/admin";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, DollarSign, Package, ShoppingCart } from "lucide-react";

export default async function AdminOverviewPage() {
  // Fetch data in parallel to make the dashboard load instantly
  const [metrics, products] = await Promise.all([getAdminOrdersAndMetrics(), getAdminProducts()]);

  const formattedRevenue = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(metrics.totalRevenue);

  const activeProductsCount = products.filter(p => p.active).length;
  const bundleCount = products.filter(p => p.isBundle).length;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
        <p className="mt-2 text-muted-foreground">Your store's high-level metrics and performance.</p>
      </div>

      {/* --- METRICS GRID --- */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {/* Revenue Card */}
        <div className="rounded-xl border border-border/50 bg-background p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-muted-foreground">Total Revenue</h3>
            <div className="h-8 w-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-emerald-500" />
            </div>
          </div>
          <p className="text-3xl font-bold text-foreground">{formattedRevenue}</p>
        </div>

        {/* Sales Card */}
        <div className="rounded-xl border border-border/50 bg-background p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-muted-foreground">Total Orders</h3>
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <ShoppingCart className="h-4 w-4 text-primary" />
            </div>
          </div>
          <p className="text-3xl font-bold text-foreground">{metrics.totalSales}</p>
        </div>

        {/* Inventory Card */}
        <div className="rounded-xl border border-border/50 bg-background p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-muted-foreground">Active Catalog</h3>
            <div className="h-8 w-8 rounded-full bg-blue-500/10 flex items-center justify-center">
              <Package className="h-4 w-4 text-blue-500" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-bold text-foreground">{activeProductsCount}</p>
            <span className="text-sm text-muted-foreground">items</span>
          </div>
          <div className="mt-2 flex gap-2">
            <Badge variant="outline" className="text-[10px] border-border/50">
              {bundleCount} Bundles
            </Badge>
          </div>
        </div>
      </div>

      {/* --- RECENT ORDERS TABLE (Preview) --- */}
      <div className="rounded-xl border border-border/50 bg-background overflow-hidden shadow-sm mt-4">
        <div className="border-b border-border/50 bg-muted/40 px-6 py-4 flex items-center justify-between">
          <h2 className="font-semibold text-foreground">Recent Transactions</h2>
          <a
            href="/admin/orders"
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
            View all <ArrowUpRight className="h-3 w-3" />
          </a>
        </div>

        <div className="divide-y divide-border/50">
          {metrics.orders.slice(0, 5).map(order => (
            <div
              key={order.id}
              className="flex items-center justify-between p-4 px-6 text-sm hover:bg-muted/10 transition-colors">
              <div className="flex flex-col">
                <span className="font-medium text-foreground">{order.customerEmail}</span>
                <span className="text-muted-foreground text-xs mt-1">
                  {new Date(order.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className="text-right">
                <span className="font-medium text-foreground">${(order.amountTotal / 100).toFixed(2)}</span>
                <div className="text-xs text-muted-foreground mt-1">{order.items?.length || 0} items</div>
              </div>
            </div>
          ))}
          {metrics.orders.length === 0 && (
            <div className="p-8 text-center text-muted-foreground text-sm">
              No orders yet. Your first sale will appear here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
