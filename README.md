# Payment Notification Handler

A Node.js backend service to handle Midtrans payment notifications and update quiz results premium status in Supabase.

## Features

- ✅ Receives Midtrans payment notifications via webhook
- ✅ Verifies notification authenticity using signature validation
- ✅ Updates quiz results `is_premium` status to `true` on successful payments
- ✅ Updates payment status in database
- ✅ Handles different payment statuses (success, failed, pending)
- ✅ Provides health check and payment status endpoints

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Server Configuration
PORT=3000

# Supabase Configuration
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_KEY=your_supabase_service_role_key

# Midtrans Configuration
MIDTRANS_SERVER_KEY=your_midtrans_server_key
```

### 3. Database Setup

Make sure your Supabase database has the following tables with the structure defined in `suabase.ts`:
- `users`
- `quiz_results` 
- `payments`
- `questions`
- `personality_types`
- `quiz_responses`

### 4. Run the Server

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## API Endpoints

### POST `/payment-notification`
Receives Midtrans payment notifications and processes them.

**Request Body:** Midtrans notification payload (JSON)

**Response:** 
- `200 OK` - Notification processed successfully
- `400 Bad Request` - Invalid signature
- `404 Not Found` - Payment record not found
- `500 Internal Server Error` - Processing error

### GET `/health`
Health check endpoint to verify service status.

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2024-01-09T10:30:00.000Z",
  "service": "Midtrans Payment Notification Handler"
}
```

### GET `/payment-status/:orderId`
Get payment and quiz result status for a specific order ID.

**Response:**
```json
{
  "id": "payment-id",
  "transaction_id": "order-id",
  "status": "completed",
  "quiz_results": {
    "id": "quiz-result-id",
    "is_premium": true,
    "personality_type": "ENFP-A"
  },
  "users": {
    "email": "user@example.com",
    "full_name": "John Doe"
  }
}
```

## Payment Flow

1. **Payment Initiated**: User completes payment via Midtrans
2. **Notification Sent**: Midtrans sends POST request to `/payment-notification`
3. **Signature Verification**: Server verifies the notification authenticity
4. **Status Processing**: 
   - ✅ **Success** (`capture` with `accept` fraud status, or `settlement`): Updates `quiz_results.is_premium` to `true`
   - ❌ **Failed** (`cancel`, `deny`, `expire`): Updates payment status to `failed`
   - ⏳ **Pending**: Updates payment status to `pending`
5. **Database Update**: Updates both `payments` and `quiz_results` tables
6. **Response**: Returns HTTP 200 OK to acknowledge receipt

## Security

- **Signature Verification**: All notifications are verified using SHA512 hash with your Midtrans server key
- **HTTPS Required**: Use HTTPS in production for secure communication
- **Service Key**: Uses Supabase service role key for admin database operations

## Midtrans Dashboard Configuration

In your Midtrans dashboard:
1. Go to **Settings > Configuration**
2. Set **Payment Notification URL** to: `https://yourdomain.com/payment-notification`
3. Make sure the URL is publicly accessible (not localhost)

## Development

For local development, you can use tools like [ngrok](https://ngrok.com/) to expose your local server:

```bash
# Run your server locally
npm run dev

# In another terminal, expose it publicly
npx ngrok http 3000
```

Then use the ngrok URL in your Midtrans dashboard configuration.

## Error Handling

The service includes comprehensive error handling:
- Invalid signatures are rejected with 400 status
- Database errors are logged and return appropriate HTTP status codes
- All notification processing is logged for debugging

## Monitoring

Check the server logs to monitor:
- Incoming notifications
- Signature verification results
- Database update operations
- Any errors or failures

The service responds with HTTP 200 even for non-successful payments to acknowledge receipt to Midtrans. 