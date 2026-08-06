import * as React from "react";
import { Order } from "@/lib/schemas";
import { siteConfig } from "@/config/siteConfig";

interface ReceiptEmailProps {
  order: Order;
}

export function ReceiptEmail({ order }: Readonly<ReceiptEmailProps>) {
  const formattedTotal = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(order.amountTotal / 100);

  return (
    <div style={{ fontFamily: "Inter, Helvetica, sans-serif", color: "#09090b", lineHeight: "1.6" }}>
      <div style={{ maxWidth: "600px", margin: "0 auto", padding: "40px 20px" }}>
        {/* Header */}
        <div style={{ paddingBottom: "24px", borderBottom: "1px solid #e4e4e7", marginBottom: "32px" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              backgroundColor: "#09090b",
              color: "#ffffff",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: "bold",
              fontSize: "14px",
              marginBottom: "16px"
            }}>
            DS
          </div>
          <h1 style={{ fontSize: "24px", fontWeight: "600", margin: "0 0 8px 0", letterSpacing: "-0.5px" }}>
            Your templates are ready
          </h1>
          <p style={{ margin: 0, color: "#71717a", fontSize: "15px" }}>
            Thank you for your purchase from {siteConfig.name}.
          </p>
        </div>

        {/* Order Details */}
        <div style={{ marginBottom: "32px" }}>
          <p style={{ margin: "0 0 4px 0", fontSize: "14px", color: "#71717a" }}>Order ID: {order.id}</p>
          <p style={{ margin: 0, fontSize: "14px", color: "#71717a" }}>
            Total: <span style={{ color: "#09090b", fontWeight: "500" }}>{formattedTotal}</span>
          </p>
        </div>

        {/* Download Links */}
        <div style={{ backgroundColor: "#f4f4f5", borderRadius: "8px", padding: "24px", marginBottom: "32px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: "600", margin: "0 0 16px 0" }}>Your Digital Assets</h2>

          {order.items.map((item, index) => (
            <div
              key={index}
              style={{
                padding: "16px 0",
                borderBottom: index !== order.items.length - 1 ? "1px solid #e4e4e7" : "none",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}>
              <span style={{ fontSize: "15px", fontWeight: "500" }}>{item.title}</span>
              <a
                href={item.deliverableUrl}
                style={{
                  backgroundColor: "#09090b",
                  color: "#ffffff",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  textDecoration: "none",
                  fontSize: "14px",
                  fontWeight: "500"
                }}>
                Download
              </a>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            paddingTop: "24px",
            borderTop: "1px solid #e4e4e7",
            fontSize: "13px",
            color: "#a1a1aa",
            textAlign: "center"
          }}>
          <p style={{ margin: 0 }}>
            You can also access your files anytime by logging into your account at{" "}
            <a href="https://yourdomain.com/dashboard" style={{ color: "#09090b", textDecoration: "underline" }}>
              yourdomain.com/dashboard
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
