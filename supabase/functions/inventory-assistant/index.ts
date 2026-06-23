import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import { CONVERSION_DICT, EGGS_PER_TRAY } from "./conversions.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EGG_FRESHNESS_DAYS = 5;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { message } = await req.json();

    if (!message) {
      throw new Error('Message is required');
    }

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }

    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Only fetch active batches (remaining > 0) to keep payload small
    const { data: inflows, error: inflowsError } = await supabase
      .from('inflows')
      .select('id, product, quantity_butir, quantity_original, remaining_butir, date, category, invoice_supplier, created_at')
      .gt('remaining_butir', 0)
      .order('date', { ascending: true })
      .limit(500);

    if (inflowsError) {
      console.error('Error fetching inflows:', inflowsError);
      throw new Error('Failed to fetch inventory data');
    }

    // Only last 3 months of outflows needed for velocity/average calculations
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 3);

    const { data: outflows, error: outflowsError } = await supabase
      .from('outflows')
      .select('id, product, quantity_butir, date, category, invoice_supplier, created_at')
      .gte('date', cutoff.toISOString().slice(0, 10))
      .order('date', { ascending: false })
      .limit(500);

    if (outflowsError) {
      console.error('Error fetching outflows:', outflowsError);
      throw new Error('Failed to fetch outflow data');
    }

    const { data: activityLogs, error: logsError } = await supabase
      .from('activity_logs')
      .select('action_type, product, quantity_butir, quantity_original, recorded_at, category, invoice_supplier, user_email')
      .order('recorded_at', { ascending: false })
      .limit(20);

    if (logsError) {
      console.error('Error fetching activity logs:', logsError);
    }

    const today = new Date();
    
    // Calculate comprehensive inventory summary with batch details
    interface BatchInfo {
      date: string;
      invoiceSupplier: string | null;
      quantity: number;
      daysOld: number;
      isAtRisk: boolean;
    }
    
    interface ProductSummary {
      total: number;
      remaining: number;
      atRiskQuantity: number;
      safeQuantity: number;
      category: string;
      batches: BatchInfo[];
    }
    
    const inventorySummary: Record<string, ProductSummary> = {};
    
    for (const inflow of inflows || []) {
      if (!inventorySummary[inflow.product]) {
        inventorySummary[inflow.product] = { 
          total: 0, 
          remaining: 0, 
          atRiskQuantity: 0,
          safeQuantity: 0,
          category: inflow.category,
          batches: []
        };
      }
      
      const inflowDate = new Date(inflow.date);
      const daysOld = Math.floor((today.getTime() - inflowDate.getTime()) / (1000 * 60 * 60 * 24));
      const isAtRisk = inflow.category === 'egg' && daysOld > EGG_FRESHNESS_DAYS;
      
      inventorySummary[inflow.product].total += inflow.quantity_butir;
      inventorySummary[inflow.product].remaining += inflow.remaining_butir;
      
      if (inflow.remaining_butir > 0) {
        if (isAtRisk) {
          inventorySummary[inflow.product].atRiskQuantity += inflow.remaining_butir;
        } else {
          inventorySummary[inflow.product].safeQuantity += inflow.remaining_butir;
        }
        
        inventorySummary[inflow.product].batches.push({
          date: inflow.date,
          invoiceSupplier: inflow.invoice_supplier,
          quantity: inflow.remaining_butir,
          daysOld,
          isAtRisk
        });
      }
    }

    // Calculate monthly averages (last 3 months — outflows already filtered to this window)
    
    const monthlyInflows: Record<string, number[]> = {};
    const monthlyOutflows: Record<string, number[]> = {};
    
    for (const inflow of inflows || []) {
      if (!monthlyInflows[inflow.product]) monthlyInflows[inflow.product] = [];
      monthlyInflows[inflow.product].push(inflow.quantity_butir);
    }

    for (const outflow of outflows || []) {
      if (!monthlyOutflows[outflow.product]) monthlyOutflows[outflow.product] = [];
      monthlyOutflows[outflow.product].push(outflow.quantity_butir);
    }

    // Build comprehensive inventory context
    let inventoryContext = "CURRENT INVENTORY WITH RISK ANALYSIS:\n";
    let totalAtRisk = 0;
    
    for (const [product, data] of Object.entries(inventorySummary)) {
      if (data.remaining > 0) {
        inventoryContext += `\n${product} (${data.category}):\n`;
        inventoryContext += `  Total: ${data.remaining.toLocaleString()} ${data.category === 'egg' ? 'butir' : 'pcs'}\n`;
        
        if (data.category === 'egg') {
          inventoryContext += `  At Risk (>5 days): ${data.atRiskQuantity.toLocaleString()} butir\n`;
          inventoryContext += `  Safe (<5 days): ${data.safeQuantity.toLocaleString()} butir\n`;
          totalAtRisk += data.atRiskQuantity;
          
          if (data.batches.length > 0) {
            inventoryContext += `  Batches (oldest first):\n`;
            for (const batch of data.batches.slice(0, 5)) { // Show up to 5 batches
              const status = batch.isAtRisk ? '❌ AT RISK' : '✅ OK';
              const supplier = batch.invoiceSupplier ? ` (${batch.invoiceSupplier})` : '';
              inventoryContext += `    - ${batch.date}${supplier}: ${batch.quantity.toLocaleString()} butir, ${batch.daysOld} days old ${status}\n`;
            }
            if (data.batches.length > 5) {
              inventoryContext += `    ... and ${data.batches.length - 5} more batches\n`;
            }
          }
        }
      }
    }
    
    inventoryContext += `\nTOTAL EGGS AT RISK: ${totalAtRisk.toLocaleString()} butir\n`;

    // Monthly averages context
    let monthlyContext = "\nMONTHLY AVERAGES (Last 3 months):\n";
    for (const [product, quantities] of Object.entries(monthlyInflows)) {
      const avgIn = Math.round(quantities.reduce((a, b) => a + b, 0) / 3);
      const outQuantities = monthlyOutflows[product] || [];
      const avgOut = outQuantities.length > 0 ? Math.round(outQuantities.reduce((a, b) => a + b, 0) / 3) : 0;
      monthlyContext += `- ${product}: Avg Inflow ~${avgIn.toLocaleString()}/month, Avg Outflow ~${avgOut.toLocaleString()}/month\n`;
    }

    // Stock velocity (days of stock remaining)
    let velocityContext = "\nSTOCK VELOCITY (Days until depleted at current rate):\n";
    for (const [product, data] of Object.entries(inventorySummary)) {
      if (data.remaining > 0) {
        const outQuantities = monthlyOutflows[product] || [];
        if (outQuantities.length > 0) {
          const avgDailyOut = outQuantities.reduce((a, b) => a + b, 0) / 90; // 90 days = 3 months
          const daysRemaining = avgDailyOut > 0 ? Math.round(data.remaining / avgDailyOut) : Infinity;
          velocityContext += `- ${product}: ~${daysRemaining === Infinity ? 'No outflow data' : `${daysRemaining} days`}\n`;
        }
      }
    }

    // Recent activity
    let activityContext = "\nRECENT ACTIVITY (Last 20 transactions):\n";
    for (const log of activityLogs || []) {
      const date = new Date(log.recorded_at).toLocaleDateString();
      const action = log.action_type === 'inflow' ? '📥 IN' : '📤 OUT';
      const user = log.user_email ? ` by ${log.user_email}` : '';
      const invoice = log.invoice_supplier ? ` (${log.invoice_supplier})` : '';
      activityContext += `- ${date}: ${action} ${log.quantity_butir.toLocaleString()} ${log.product}${invoice}${user}\n`;
    }

    // Build the authoritative conversion map: catalog egg rows (item_types) layered
    // over the hardcoded baseline, so newly added egg types (e.g. "Retakan") are
    // included without a redeploy. The baseline guarantees the originals always resolve.
    const conversionMap: Record<string, { unit: string; eggs_per_unit: number }> = {
      ...CONVERSION_DICT,
    };
    const { data: eggTypes, error: eggTypesError } = await supabase
      .from('item_types')
      .select('name, unit, eggs_per_unit')
      .eq('category', 'egg')
      .is('deleted_at', null);
    if (eggTypesError) {
      console.error('Error fetching egg item types (using baseline conversions):', eggTypesError);
    }
    for (const row of eggTypes || []) {
      if (row.unit && row.eggs_per_unit != null) {
        conversionMap[row.name] = { unit: row.unit, eggs_per_unit: Number(row.eggs_per_unit) };
      }
    }

    // Build the authoritative unit-conversion reference from the same table the app uses.
    const kgProducts = Object.entries(conversionMap).filter(([, c]) => c.unit === "kg");
    const btrProducts = Object.entries(conversionMap).filter(([, c]) => c.unit === "btr");

    let conversionContext = "UNIT CONVERSION RULES (authoritative — these come directly from the system, NEVER estimate or guess a conversion factor):\n";
    conversionContext += `- "butir" (btr) means one individual egg. All stock totals above are in butir.\n`;
    conversionContext += `- Weight-sold eggs (priced per kg) and their EXACT kg→butir factor:\n`;
    for (const [product, c] of kgProducts) {
      conversionContext += `    • ${product}: 1 kg = ${c.eggs_per_unit} butir (so X kg = X × ${c.eggs_per_unit} butir; X butir = X ÷ ${c.eggs_per_unit} kg)\n`;
    }
    conversionContext += `- All other egg types are counted per egg (1 unit = 1 butir, no kg conversion): ${btrProducts.map(([p]) => p).join(", ")}.\n`;
    conversionContext += `- 1 tray = ${EGGS_PER_TRAY} butir.\n`;
    conversionContext += `- Boxes, labels, and packaging are counted in pieces (pcs), not butir.\n`;
    conversionContext += `- Worked example: 10 kg of NEGERI BIASA = 10 × 15.5 = 155 butir. 310 butir of NEGERI OMEGA = 310 ÷ 15.5 = 20 kg.\n`;
    conversionContext += `- If asked to convert a product not listed above, say you don't have a conversion factor for it rather than inventing one.\n`;

    const systemPrompt = `You are a highly capable warehouse inventory secretary/assistant. You have complete access to all inventory data and can answer any question about stock levels, batches, suppliers, transactions, and analytics.

${conversionContext}
${inventoryContext}
${monthlyContext}
${velocityContext}
${activityContext}

YOUR CAPABILITIES:
- Report exact stock levels for any product
- Identify at-risk eggs (>5 days old) with specific batch details
- Show which batches came from which supplier/invoice
- Calculate monthly averages for inflows and outflows
- Estimate when stock will run out based on usage patterns
- Report recent transaction history
- Identify slow-moving or fast-moving products
- Convert between kg, butir, trays, and pieces using the UNIT CONVERSION RULES above — but ONLY when the user explicitly asks for a conversion or for a specific unit
- Answer questions in the same language as the user

GUIDELINES:
- Be precise and use exact numbers from the data
- If asked about at-risk eggs, provide batch-level details (date, supplier, quantity)
- If asked about trends, use the monthly averages
- Proactively mention important issues like high at-risk quantities
- Be concise but thorough
- Report quantities in their native unit (butir for eggs, pcs for boxes/labels/packaging). Do NOT proactively convert to kg or trays — only convert when the user specifically asks for a different unit. When you do convert, use the exact factors from the UNIT CONVERSION RULES and never guess
- If a product is not in inventory, say so clearly`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [
          { role: 'user', content: message }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', response.status, errorText);

      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw new Error('Anthropic API error');
    }

    const data = await response.json();
    const assistantMessage = data.content?.[0]?.text || 'Sorry, I could not generate a response.';

    return new Response(JSON.stringify({ response: assistantMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Error in inventory-assistant:', error);
    const errorMessage = error instanceof Error ? error.message : 'An error occurred';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});