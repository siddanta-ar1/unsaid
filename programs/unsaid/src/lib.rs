//! UNSAID ownership layer.
//!
//! This program stores proof that a specific encrypted memory existed, that a
//! specific key owns it, and when that was established. It stores nothing else.
//!
//! Blueprint §14.3 — what must never appear in this file: plaintext thoughts,
//! transcripts, audio, email addresses, phone numbers, or encryption keys. A
//! Solana account is public and permanent; treat every byte written here as
//! published forever.
//!
//! The `commitment` is a SHA-256 over the thought id and the *ciphertext* hash.
//! It proves a particular encrypted object existed at a point in time without
//! revealing anything about what it says.

use anchor_lang::prelude::*;

declare_id!("7nRKgRMiHfXg3fUXPRFdNX97BWfSKhNqvBaXZM5BLcHZ");

#[program]
pub mod unsaid {
    use super::*;

    /// Anchors one memory. The PDA is derived from the owner and thought id, so
    /// a repeated submission of the same anchor hits the same address and fails
    /// as already-initialised rather than creating a duplicate record (D-03).
    pub fn create_record(
        ctx: Context<CreateRecord>,
        thought_id: [u8; 32],
        commitment: [u8; 32],
        access_mode: u8,
    ) -> Result<()> {
        require!(commitment != [0u8; 32], UnsaidError::EmptyCommitment);
        require!(access_mode <= AccessMode::MAX, UnsaidError::InvalidAccessMode);

        let record = &mut ctx.accounts.record;
        record.owner = ctx.accounts.owner.key();
        record.thought_id = thought_id;
        record.commitment = commitment;
        record.version = 1;
        record.status = RecordStatus::Active as u8;
        record.access_mode = access_mode;
        record.created_at = Clock::get()?.unix_timestamp;
        record.updated_at = record.created_at;
        record.bump = ctx.bumps.record;

        emit!(RecordCreated {
            owner: record.owner,
            thought_id,
            created_at: record.created_at,
        });

        Ok(())
    }

    /// Updates the policy fields a record is allowed to change. The commitment
    /// is deliberately immutable: a proof that can be rewritten is not a proof.
    pub fn update_record(ctx: Context<UpdateRecord>, access_mode: u8) -> Result<()> {
        require!(access_mode <= AccessMode::MAX, UnsaidError::InvalidAccessMode);

        let record = &mut ctx.accounts.record;
        require!(
            record.status == RecordStatus::Active as u8,
            UnsaidError::RecordNotActive
        );

        record.access_mode = access_mode;
        record.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Marks a record revoked.
    ///
    /// This is an application-level signal, not erasure. The transaction
    /// history stays visible forever, which is exactly why no content was ever
    /// written here — the honest guarantee is that there is nothing on-chain
    /// worth reading (§12.4).
    pub fn revoke_record(ctx: Context<UpdateRecord>) -> Result<()> {
        let record = &mut ctx.accounts.record;
        require!(
            record.status == RecordStatus::Active as u8,
            UnsaidError::RecordNotActive
        );

        record.status = RecordStatus::Revoked as u8;
        record.updated_at = Clock::get()?.unix_timestamp;

        emit!(RecordRevoked {
            owner: record.owner,
            thought_id: record.thought_id,
            revoked_at: record.updated_at,
        });

        Ok(())
    }

    /// Closes the record and returns its rent to the owner. The account stops
    /// existing; the historical transactions that created it do not.
    pub fn close_record(_ctx: Context<CloseRecord>) -> Result<()> {
        Ok(())
    }

    /// Records one access to one memory, so that it cannot be denied later.
    ///
    /// This is the half of the system that is not about ownership. A vault that
    /// only its owner can read is a claim we make about ourselves; a receipt on
    /// a ledger we do not control is a claim anyone can check. What goes here is
    /// the shape of an access, never its content: which memory, which version of
    /// the consent text, which code ran, and a hash of what came back.
    ///
    /// The signer is the recorder — us — not the subject. That is deliberate and
    /// it is the weak point, so it is worth stating plainly: a recorder can fail
    /// to write a receipt, and nothing on chain forces it to. What it cannot do
    /// is write one and later change it, or access a memory and produce a
    /// receipt that says otherwise, or deny a receipt that exists. The client
    /// knows when it asked for a reflection, so a missing receipt is visible to
    /// the one person who would care.
    ///
    /// The subject is a domain-separated digest of the vault, not a wallet. A
    /// user who never connects a wallet still gets an audit trail, which is the
    /// point — the protection cannot be reserved for the people who own crypto.
    pub fn record_consent(
        ctx: Context<RecordConsent>,
        receipt_id: [u8; 32],
        subject: [u8; 32],
        thought_id: [u8; 32],
        purpose: u8,
        consent_version: u16,
        attestation: [u8; 32],
        result_hash: [u8; 32],
    ) -> Result<()> {
        require!(purpose <= Purpose::MAX, UnsaidError::InvalidPurpose);
        // A receipt that does not say which wording was agreed to records
        // nothing worth recording: consent is to a text, not to a flag.
        require!(consent_version > 0, UnsaidError::MissingConsentVersion);

        // Reflection is the one purpose where content leaves the device for a
        // third party to compute on. An unattested reflection must be impossible
        // to record rather than merely discouraged, because a receipt that can
        // silently omit the measurement is worse than no receipt: it looks like
        // evidence while proving nothing about what ran.
        // Reflection is the one purpose where content leaves the device for a
        // third party to compute on, so the two cases are distinct instructions
        // to the reader of the log rather than a field they have to interpret.
        // An attested reflection must carry a measurement; an unattested one
        // must carry none, so that "we could not prove what ran" can never be
        // dressed up as "we did", and an attested run cannot be quietly filed
        // as an ordinary one either.
        if purpose == Purpose::REFLECTION {
            require!(attestation != [0u8; 32], UnsaidError::MissingAttestation);
        }
        if purpose == Purpose::REFLECTION_UNATTESTED {
            require!(attestation == [0u8; 32], UnsaidError::UnexpectedAttestation);
        }

        let receipt = &mut ctx.accounts.receipt;
        receipt.recorder = ctx.accounts.recorder.key();
        receipt.receipt_id = receipt_id;
        receipt.subject = subject;
        receipt.thought_id = thought_id;
        receipt.purpose = purpose;
        receipt.consent_version = consent_version;
        receipt.attestation = attestation;
        receipt.result_hash = result_hash;
        receipt.created_at = Clock::get()?.unix_timestamp;
        receipt.bump = ctx.bumps.receipt;

        emit!(ConsentRecorded {
            recorder: receipt.recorder,
            subject,
            thought_id,
            purpose,
            created_at: receipt.created_at,
        });

        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct ThoughtRecord {
    /// The wallet that anchored this. Optional at the product level — a user
    /// who never connects a wallet simply has no records here (§14.5).
    pub owner: Pubkey,
    /// Opaque application id. Random, and not derived from any user identity.
    pub thought_id: [u8; 32],
    /// SHA-256 over the thought id and the ciphertext hash. Not the content.
    pub commitment: [u8; 32],
    pub version: u8,
    pub status: u8,
    pub access_mode: u8,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

#[repr(u8)]
pub enum RecordStatus {
    Active = 0,
    Revoked = 1,
}

/// One recorded access. There is no instruction that changes it and none that
/// closes it: a receipt that can be edited or withdrawn is not a receipt, and
/// the rent is the price of that guarantee.
#[account]
#[derive(InitSpace)]
pub struct ConsentReceipt {
    /// The key that wrote this. Published, so a receipt from an unexpected
    /// recorder is as visible as a missing one.
    pub recorder: Pubkey,
    /// Unique per access; also the seed that makes the address deterministic.
    pub receipt_id: [u8; 32],
    /// Whose data this concerns — a digest of the vault, never a wallet, so
    /// that users without one are covered too.
    pub subject: [u8; 32],
    /// Which memory, as the same domain-separated digest the proof records use.
    pub thought_id: [u8; 32],
    /// The measurement of the code that ran. Zero is only legal for purposes
    /// where nothing left the device.
    pub attestation: [u8; 32],
    /// A hash of what came back, so the answer shown to the user can be tied to
    /// the access that produced it without storing the answer.
    pub result_hash: [u8; 32],
    /// The version of the consent text that was agreed to, not a boolean.
    pub consent_version: u16,
    pub purpose: u8,
    pub created_at: i64,
    pub bump: u8,
}

pub struct Purpose;
impl Purpose {
    /// Content left the device for a third party to compute on. Requires an
    /// attestation.
    pub const REFLECTION: u8 = 0;
    /// The user took their own data out. Nothing left the device unencrypted.
    pub const EXPORT: u8 = 1;
    /// The user handed someone else a way in.
    pub const SHARE: u8 = 2;
    /// Content left the device for a provider that cannot prove what code ran.
    /// Recorded as its own purpose so the log shows the difference instead of
    /// asking anyone to notice a missing field.
    pub const REFLECTION_UNATTESTED: u8 = 3;
    pub const MAX: u8 = Self::REFLECTION_UNATTESTED;
}

pub struct AccessMode;
impl AccessMode {
    pub const PRIVATE: u8 = 0;
    pub const SHARED_LINK: u8 = 1;
    pub const PUBLIC_PROOF: u8 = 2;
    pub const MAX: u8 = Self::PUBLIC_PROOF;
}

#[derive(Accounts)]
#[instruction(thought_id: [u8; 32])]
pub struct CreateRecord<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + ThoughtRecord::INIT_SPACE,
        // Deriving from owner + thought_id makes the address deterministic,
        // which is what gives retries idempotency for free.
        seeds = [b"thought", owner.key().as_ref(), thought_id.as_ref()],
        bump
    )]
    pub record: Account<'info, ThoughtRecord>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateRecord<'info> {
    #[account(
        mut,
        // `has_one` is the authorization check: a record can only be changed by
        // the key recorded as its owner, whoever signs the transaction.
        has_one = owner @ UnsaidError::NotRecordOwner,
        seeds = [b"thought", owner.key().as_ref(), record.thought_id.as_ref()],
        bump = record.bump
    )]
    pub record: Account<'info, ThoughtRecord>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(receipt_id: [u8; 32], subject: [u8; 32])]
pub struct RecordConsent<'info> {
    #[account(
        init,
        payer = recorder,
        space = 8 + ConsentReceipt::INIT_SPACE,
        // Seeded by subject and receipt id, so the same access recorded twice
        // collides rather than duplicating — a retry after a timeout cannot
        // inflate someone's access log.
        seeds = [b"consent", subject.as_ref(), receipt_id.as_ref()],
        bump
    )]
    pub receipt: Account<'info, ConsentReceipt>,
    /// The recorder pays. Charging the subject rent to be told they were
    /// accessed would be a strange thing to build.
    #[account(mut)]
    pub recorder: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseRecord<'info> {
    #[account(
        mut,
        has_one = owner @ UnsaidError::NotRecordOwner,
        close = owner,
        seeds = [b"thought", owner.key().as_ref(), record.thought_id.as_ref()],
        bump = record.bump
    )]
    pub record: Account<'info, ThoughtRecord>,
    #[account(mut)]
    pub owner: Signer<'info>,
}

#[event]
pub struct RecordCreated {
    pub owner: Pubkey,
    pub thought_id: [u8; 32],
    pub created_at: i64,
}

#[event]
pub struct RecordRevoked {
    pub owner: Pubkey,
    pub thought_id: [u8; 32],
    pub revoked_at: i64,
}

#[event]
pub struct ConsentRecorded {
    pub recorder: Pubkey,
    pub subject: [u8; 32],
    pub thought_id: [u8; 32],
    pub purpose: u8,
    pub created_at: i64,
}

#[error_code]
pub enum UnsaidError {
    #[msg("The commitment must not be empty.")]
    EmptyCommitment,
    #[msg("Unknown access mode.")]
    InvalidAccessMode,
    #[msg("Only the recorded owner may modify this record.")]
    NotRecordOwner,
    #[msg("This record is not active.")]
    RecordNotActive,
    #[msg("Unknown purpose.")]
    InvalidPurpose,
    #[msg("A receipt must name the version of the consent text that was agreed to.")]
    MissingConsentVersion,
    #[msg("A reflection cannot be recorded without an attestation of the code that ran.")]
    MissingAttestation,
    #[msg("An unattested reflection must not carry a measurement.")]
    UnexpectedAttestation,
}
