from extensions.ext_database import db


class ComponentFailure(db.Model):
    __tablename__ = "component_failure"
    __table_args__ = (
        db.UniqueConstraint("Date", "Component", "FailureMode", "Cause", "Technician", name="unique_failure_entry"),
    )

    FailureID = db.Column(db.Integer, primary_key=True, autoincrement=True)
    Date = db.Column(db.Date, nullable=False)
    Component = db.Column(db.String(255), nullable=False)
    FailureMode = db.Column(db.String(255), nullable=False)
    Cause = db.Column(db.String(255), nullable=False)
    RepairAction = db.Column(db.Text, nullable=True)
    Technician = db.Column(db.String(255), nullable=False)


class Maintenance(db.Model):
    __tablename__ = "maintenance"

    MaintenanceID = db.Column(db.Integer, primary_key=True, autoincrement=True)
    MaintenanceType = db.Column(db.String(255), nullable=False)
    MaintenanceDate = db.Column(db.Date, nullable=False)
    ServiceDescription = db.Column(db.Text, nullable=True)
    PartsReplaced = db.Column(db.Text, nullable=True)
    Technician = db.Column(db.String(255), nullable=False)


class OperationalData(db.Model):
    __tablename__ = "operational_data"

    OperationID = db.Column(db.Integer, primary_key=True, autoincrement=True)
    CraneUsage = db.Column(db.Integer, nullable=False)
    LoadWeight = db.Column(db.Float, nullable=False)
    LoadFrequency = db.Column(db.Integer, nullable=False)
    EnvironmentalConditions = db.Column(db.Text, nullable=True)


class IncidentData(db.Model):
    __tablename__ = "incident_data"

    IncidentID = db.Column(db.Integer, primary_key=True, autoincrement=True)
    IncidentDescription = db.Column(db.Text, nullable=False)
    IncidentDate = db.Column(db.Date, nullable=False)
    Consequences = db.Column(db.Text, nullable=True)
    ResponseActions = db.Column(db.Text, nullable=True)


class ReliabilityData(db.Model):
    __tablename__ = "reliability_data"

    ComponentID = db.Column(db.Integer, primary_key=True, autoincrement=True)
    ComponentName = db.Column(db.String(255), nullable=False)
    MTBF = db.Column(db.Float, nullable=False)
    FailureRate = db.Column(db.Float, nullable=False)


class SafetyData(db.Model):
    __tablename__ = "safety_data"

    SafetyID = db.Column(db.Integer, primary_key=True, autoincrement=True)
    SafetyInspectionDate = db.Column(db.Date, nullable=False)
    SafetyFindings = db.Column(db.Text, nullable=True)
    SafetyIncidentDescription = db.Column(db.Text, nullable=True)
    ComplianceStatus = db.Column(db.String(50), nullable=False)


class ComponentFailureStats(db.Model):
    __tablename__ = "component_failure_stats"

    StatID = db.Column(db.Integer, primary_key=True, autoincrement=True)
    Component = db.Column(db.String(255), nullable=False)
    FailureMode = db.Column(db.String(255), nullable=False)
    Cause = db.Column(db.String(255), nullable=False)
    PossibleAction = db.Column(db.Text, nullable=True)
    Probability = db.Column(db.Float, nullable=False)
    MTBF = db.Column(db.Float, nullable=False)
