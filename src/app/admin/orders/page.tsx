import { getAdminOrdersAndMetrics } from "@/queries/admin";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2 } from "lucide-react";

export default async function AdminOrdersPage() {
  const { orders } = await getAdminOrdersAndMetrics();

  return (
    <div className="flex flex-col gap-8">
      {/* --- PAGE HEADER --- */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Orders</h1>
          <p className="mt-2 text-muted-foreground">A complete history of all successful transactions.</p>
        </div>
      </div>

      {/* --- DATA TABLE --- */}
      <div className="overflow-hidden rounded-xl border border-border/50 bg-background shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border/50 bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="px-6 py-4 font-medium tracking-wider">
                  Order ID
                </th>
                <th scope="col" className="px-6 py-4 font-medium tracking-wider">
                  Customer
                </th>
                <th scope="col" className="px-6 py-4 font-medium tracking-wider">
                  Date
                </th>
                <th scope="col" className="px-6 py-4 font-medium tracking-wider">
                  Items
                </th>
                <th scope="col" className="px-6 py-4 text-right font-medium tracking-wider">
                  Amount
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border/50">
              {orders.map(order => (
                <tr key={order.id} className="transition-colors hover:bg-muted/10">
                  {/* Order ID Column */}
                  <td className="px-6 py-4 font-mono text-xs text-muted-foreground">{order.id.slice(0, 8)}...</td>

                  {/* Customer Column */}
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{order.customerEmail}</span>
                      {order.deliveryEmailSent && (
                        <span title="Delivery Email Sent" aria-label="Delivery Email Sent">
                          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Date Column */}
                  <td className="px-6 py-4 text-muted-foreground">
                    {new Date(order.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit"
                    })}
                  </td>

                  {/* Items Column */}
                  <td className="px-6 py-4">
                    <Badge variant="outline" className="border-border/50 text-[10px]">
                      {order.items?.length || 0} items
                    </Badge>
                  </td>

                  {/* Amount Column */}
                  <td className="px-6 py-4 text-right font-medium text-foreground">
                    ${(order.amountTotal / 100).toFixed(2)}
                  </td>
                </tr>
              ))}

              {orders.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                    No orders found. Once you launch, sales will appear here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
