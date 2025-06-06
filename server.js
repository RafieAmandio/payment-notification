const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.raw({ type: 'application/json' }));

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY; // Use service key for admin operations
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Midtrans configuration
const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;

// Function to verify Midtrans signature
function verifySignature(orderId, statusCode, grossAmount, signature) {
    const input = orderId + statusCode + grossAmount + MIDTRANS_SERVER_KEY;
    const hash = crypto.createHash('sha512').update(input).digest('hex');
    return hash === signature;
}

// Midtrans notification endpoint
app.post('/payment-notification', async (req, res) => {
    try {
        console.log('Received notification:', JSON.stringify(req.body, null, 2));
        
        const {
            transaction_status,
            transaction_id,
            order_id,
            gross_amount,
            signature_key,
            fraud_status,
            status_code,
            payment_type
        } = req.body;

        // Verify signature for security
        if (!verifySignature(order_id, status_code, gross_amount, signature_key)) {
            console.error('Invalid signature');
            return res.status(400).json({ error: 'Invalid signature' });
        }

        console.log(`Processing notification for order: ${order_id}, status: ${transaction_status}`);

        // Check if transaction is successful
        const isSuccessful = (
            (transaction_status === 'capture' && fraud_status === 'accept') ||
            transaction_status === 'settlement'
        );

        if (isSuccessful) {
            console.log('Payment successful, updating premium status...');
            
            // Find the payment record using order_id (which should be the transaction_id in payments table)
            const { data: paymentData, error: paymentError } = await supabase
                .from('payments')
                .select('quiz_result_id, user_id')
                .eq('transaction_id', order_id)
                .single();

            if (paymentError) {
                console.error('Error finding payment:', paymentError);
                return res.status(404).json({ error: 'Payment record not found' });
            }

            // Update the quiz result to premium
            const { error: updateError } = await supabase
                .from('quiz_results')
                .update({ is_premium: true })
                .eq('id', paymentData.quiz_result_id);

            if (updateError) {
                console.error('Error updating quiz result:', updateError);
                return res.status(500).json({ error: 'Failed to update quiz result' });
            }

            // Update payment status to completed
            const { error: paymentUpdateError } = await supabase
                .from('payments')
                .update({ 
                    status: 'completed',
                    payment_date: new Date().toISOString()
                })
                .eq('transaction_id', order_id);

            if (paymentUpdateError) {
                console.error('Error updating payment status:', paymentUpdateError);
            }

            console.log(`Successfully updated quiz result ${paymentData.quiz_result_id} to premium`);
            
        } else if (transaction_status === 'cancel' || transaction_status === 'deny' || transaction_status === 'expire') {
            console.log('Payment failed/cancelled, updating payment status...');
            
            // Update payment status to failed
            const { error: paymentUpdateError } = await supabase
                .from('payments')
                .update({ status: 'failed' })
                .eq('transaction_id', order_id);

            if (paymentUpdateError) {
                console.error('Error updating payment status:', paymentUpdateError);
            }
            
        } else if (transaction_status === 'pending') {
            console.log('Payment pending...');
            
            // Update payment status to pending
            const { error: paymentUpdateError } = await supabase
                .from('payments')
                .update({ status: 'pending' })
                .eq('transaction_id', order_id);

            if (paymentUpdateError) {
                console.error('Error updating payment status:', paymentUpdateError);
            }
        }

        // Respond with 200 OK to acknowledge receipt
        res.status(200).json({ message: 'Notification processed successfully' });
        
    } catch (error) {
        console.error('Error processing notification:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'Midtrans Payment Notification Handler'
    });
});

// Get payment status endpoint (for manual verification)
app.get('/payment-status/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        
        const { data, error } = await supabase
            .from('payments')
            .select(`
                *,
                quiz_results!inner(id, is_premium, personality_type),
                users!inner(email, full_name)
            `)
            .eq('transaction_id', orderId)
            .single();

        if (error) {
            return res.status(404).json({ error: 'Payment not found' });
        }

        res.json(data);
    } catch (error) {
        console.error('Error fetching payment status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Payment notification server running on port ${PORT}`);
    console.log(`Notification endpoint: http://localhost:${PORT}/payment-notification`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});

module.exports = app; 