const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enhanced logging function
function logInfo(message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] INFO: ${message}`);
    if (data) {
        console.log(`[${timestamp}] DATA:`, JSON.stringify(data, null, 2));
    }
}

function logError(message, error = null) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ERROR: ${message}`);
    if (error) {
        console.error(`[${timestamp}] ERROR DETAILS:`, error);
    }
}

function logWarning(message, data = null) {
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] WARNING: ${message}`);
    if (data) {
        console.warn(`[${timestamp}] WARNING DATA:`, JSON.stringify(data, null, 2));
    }
}

// Global error handlers
process.on('uncaughtException', (error) => {
    logError('Uncaught Exception', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logError('Unhandled Rejection', { reason, promise });
    process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logInfo('SIGTERM received, shutting down gracefully...');
    server.close(() => {
        logInfo('Process terminated');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    logInfo('SIGINT received, shutting down gracefully...');
    server.close(() => {
        logInfo('Process terminated');
        process.exit(0);
    });
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.raw({ type: 'application/json', limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${req.ip}`);
    console.log(`[${timestamp}] Headers:`, JSON.stringify(req.headers, null, 2));
    next();
});

// Error handling middleware
app.use((error, req, res, next) => {
    logError('Express error handler', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY; // Use service key for admin operations

// Validate environment variables
if (!supabaseUrl) {
    logError('SUPABASE_URL environment variable is required');
    process.exit(1);
}

if (!supabaseServiceKey) {
    logError('SUPABASE_SERVICE_KEY environment variable is required');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Midtrans configuration
const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;

if (!MIDTRANS_SERVER_KEY) {
    logError('MIDTRANS_SERVER_KEY environment variable is required');
    process.exit(1);
}

// Log configuration on startup
console.log('='.repeat(50));
console.log('Payment Notification Handler Starting...');
console.log('='.repeat(50));
console.log('Configuration:');
console.log(`- Port: ${PORT}`);
console.log(`- Supabase URL: ${supabaseUrl ? 'Set' : 'NOT SET'}`);
console.log(`- Supabase Service Key: ${supabaseServiceKey ? 'Set' : 'NOT SET'}`);
console.log(`- Midtrans Server Key: ${MIDTRANS_SERVER_KEY ? 'Set' : 'NOT SET'}`);
console.log('='.repeat(50));

// Test Supabase connection
async function testSupabaseConnection() {
    try {
        logInfo('Testing Supabase connection...');
        const { data, error } = await supabase
            .from('users')
            .select('count')
            .limit(1);
        
        if (error) {
            logError('Supabase connection test failed', error);
            return false;
        }
        
        logInfo('Supabase connection successful');
        return true;
    } catch (error) {
        logError('Supabase connection test error', error);
        return false;
    }
}

// Function to verify Midtrans signature
function verifySignature(orderId, statusCode, grossAmount, signature) {
    try {
        const input = orderId + statusCode + grossAmount + MIDTRANS_SERVER_KEY;
        const hash = crypto.createHash('sha512').update(input).digest('hex');
        
        logInfo('Signature verification', {
            orderId,
            statusCode,
            grossAmount,
            inputString: input,
            calculatedHash: hash,
            receivedSignature: signature,
            match: hash === signature
        });
        
        return hash === signature;
    } catch (error) {
        logError('Error in signature verification', error);
        return false;
    }
}

// Midtrans notification endpoint
app.post('/payment-notification', async (req, res) => {
    const startTime = Date.now();
    logInfo('=== PAYMENT NOTIFICATION RECEIVED ===');
    
    try {
        logInfo('Raw request body received', req.body);
        logInfo('Request headers', req.headers);
        
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

        logInfo('Extracted notification data', {
            transaction_status,
            transaction_id,
            order_id,
            gross_amount,
            signature_key: signature_key ? 'Present' : 'Missing',
            fraud_status,
            status_code,
            payment_type
        });

        // Check for required fields
        if (!order_id || !status_code || !gross_amount || !signature_key) {
            logError('Missing required fields in notification', {
                order_id: !!order_id,
                status_code: !!status_code,
                gross_amount: !!gross_amount,
                signature_key: !!signature_key
            });
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Verify signature for security
        logInfo('Starting signature verification...');
        const isValidSignature = verifySignature(order_id, status_code, gross_amount, signature_key);
        
        if (!isValidSignature) {
            logError('Invalid signature detected', {
                order_id,
                status_code,
                gross_amount,
                received_signature: signature_key
            });
            return res.status(400).json({ error: 'Invalid signature' });
        }

        logInfo('Signature verification passed');
        logInfo(`Processing notification for order: ${order_id}, status: ${transaction_status}`);

        // Check if transaction is successful
        const isSuccessful = (
            (transaction_status === 'capture' && fraud_status === 'accept') ||
            transaction_status === 'settlement'
        );

        logInfo('Transaction status analysis', {
            transaction_status,
            fraud_status,
            isSuccessful
        });

        if (isSuccessful) {
            logInfo('Payment successful, starting database update process...');
            
            // Find the payment record using order_id (which should be the transaction_id in payments table)
            logInfo(`Looking for payment record with transaction_id: ${order_id}`);
            
            const { data: paymentData, error: paymentError } = await supabase
                .from('payments')
                .select('quiz_result_id, user_id')
                .eq('transaction_id', order_id)
                .single();

            if (paymentError) {
                logError('Error finding payment in database', {
                    error: paymentError,
                    transaction_id: order_id
                });
                return res.status(404).json({ error: 'Payment record not found' });
            }

            logInfo('Payment record found', paymentData);

            // Update the quiz result to premium
            logInfo(`Updating quiz result ${paymentData.quiz_result_id} to premium...`);
            
            const { error: updateError } = await supabase
                .from('quiz_results')
                .update({ is_premium: true })
                .eq('id', paymentData.quiz_result_id);

            if (updateError) {
                logError('Error updating quiz result to premium', {
                    error: updateError,
                    quiz_result_id: paymentData.quiz_result_id
                });
                return res.status(500).json({ error: 'Failed to update quiz result' });
            }

            logInfo('Quiz result successfully updated to premium');

            // Update payment status to completed
            logInfo('Updating payment status to completed...');
            
            const { error: paymentUpdateError } = await supabase
                .from('payments')
                .update({ 
                    status: 'completed',
                    payment_date: new Date().toISOString()
                })
                .eq('transaction_id', order_id);

            if (paymentUpdateError) {
                logError('Error updating payment status', {
                    error: paymentUpdateError,
                    transaction_id: order_id
                });
            } else {
                logInfo('Payment status updated to completed');
            }

            logInfo(`Successfully processed successful payment for quiz result ${paymentData.quiz_result_id}`);
            
        } else if (transaction_status === 'cancel' || transaction_status === 'deny' || transaction_status === 'expire') {
            logInfo('Payment failed/cancelled, updating payment status...');
            
            // Update payment status to failed
            const { error: paymentUpdateError } = await supabase
                .from('payments')
                .update({ status: 'failed' })
                .eq('transaction_id', order_id);

            if (paymentUpdateError) {
                logError('Error updating payment status to failed', {
                    error: paymentUpdateError,
                    transaction_id: order_id
                });
            } else {
                logInfo('Payment status updated to failed');
            }
            
        } else if (transaction_status === 'pending') {
            logInfo('Payment pending, updating payment status...');
            
            // Update payment status to pending
            const { error: paymentUpdateError } = await supabase
                .from('payments')
                .update({ status: 'pending' })
                .eq('transaction_id', order_id);

            if (paymentUpdateError) {
                logError('Error updating payment status to pending', {
                    error: paymentUpdateError,
                    transaction_id: order_id
                });
            } else {
                logInfo('Payment status updated to pending');
            }
        } else {
            logWarning('Unhandled transaction status', {
                transaction_status,
                order_id
            });
        }

        const processingTime = Date.now() - startTime;
        logInfo(`Notification processing completed in ${processingTime}ms`);
        logInfo('=== PAYMENT NOTIFICATION PROCESSING COMPLETE ===');

        // Respond with 200 OK to acknowledge receipt
        res.status(200).json({ 
            message: 'Notification processed successfully',
            order_id,
            processing_time_ms: processingTime
        });
        
    } catch (error) {
        const processingTime = Date.now() - startTime;
        logError('Unexpected error processing notification', {
            error: error.message,
            stack: error.stack,
            processing_time_ms: processingTime
        });
        logError('=== PAYMENT NOTIFICATION PROCESSING FAILED ===');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'Midtrans Payment Notification Handler',
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
});

// Get payment status endpoint (for manual verification)
app.get('/payment-status/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        logInfo(`Payment status request for order: ${orderId}`);
        
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
            logError('Payment status not found', { orderId, error });
            return res.status(404).json({ error: 'Payment not found' });
        }

        logInfo('Payment status retrieved successfully', { orderId });
        res.json(data);
    } catch (error) {
        logError('Error fetching payment status', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
const server = app.listen(PORT, async () => {
    console.log('='.repeat(50));
    console.log(`✅ Payment notification server running on port ${PORT}`);
    console.log(`📝 Notification endpoint: http://localhost:${PORT}/payment-notification`);
    console.log(`❤️  Health check: http://localhost:${PORT}/health`);
    console.log('='.repeat(50));
    
    // Test connections on startup
    await testSupabaseConnection();
    
    logInfo('Server startup complete - ready to receive notifications');
});

module.exports = app; 